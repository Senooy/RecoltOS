//! Minimal JSON handling for the relay, std only.
//!
//! The host never needs a JSON tree: it validates a message (same grammar as `JSON.parse`), drops
//! the insignificant whitespace (what `JSON.stringify(JSON.parse(x))` does for NDJSON safety) and
//! reads a few top-level fields. The scanner is iterative (no depth limit, like V8) and accepts
//! lone UTF-16 surrogates in `\u` escapes (like `JSON.parse`; a tweet cut in the middle of an
//! emoji produces one).

use std::ops::Range;

/// A validated JSON text, without insignificant whitespace.
pub struct Scanned {
    /// Compact text (no newline outside strings: safe for NDJSON).
    pub compact: Vec<u8>,
    /// Top-level object fields, in order (`None` when the value is not an object).
    fields: Option<Vec<(Range<usize>, Range<usize>)>>,
}

impl Scanned {
    pub fn is_object(&self) -> bool {
        self.fields.is_some()
    }

    /// Raw compact text of a top-level field (the last one wins, like `JSON.parse`).
    pub fn field(&self, name: &str) -> Option<&[u8]> {
        let fields = self.fields.as_ref()?;
        fields
            .iter()
            .rev()
            .find(|(k, _)| decode_str(&self.compact[k.clone()]) == name)
            .map(|(_, v)| &self.compact[v.clone()])
    }

    /// `typeof field === 'string'` → its value.
    pub fn str_field(&self, name: &str) -> Option<String> {
        self.field(name)
            .filter(|r| r.first() == Some(&b'"'))
            .map(decode_str)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Value,
    ArrFirstOrEnd,
    ObjFirstOrEnd,
    ObjKey,
    ObjColon,
    AfterValue,
}

fn is_ws(c: u8) -> bool {
    matches!(c, b' ' | b'\t' | b'\n' | b'\r')
}

/// Validates `input` as JSON (`JSON.parse` grammar) and returns its compact form, or `None`.
pub fn scan(input: &[u8]) -> Option<Scanned> {
    let mut out: Vec<u8> = Vec::with_capacity(input.len());
    // Container stack: `true` = object, `false` = array.
    let mut stack: Vec<bool> = Vec::new();
    let mut state = State::Value;
    let mut top_is_object = false;
    let mut fields: Vec<(Range<usize>, Range<usize>)> = Vec::new();
    let mut key: Option<Range<usize>> = None;
    let mut value_start: Option<usize> = None;
    let mut seen_value = false;
    let mut i = 0;
    let n = input.len();

    loop {
        while i < n && is_ws(input[i]) {
            i += 1;
        }
        if i >= n {
            break;
        }
        let c = input[i];
        match state {
            State::Value | State::ArrFirstOrEnd => {
                if state == State::ArrFirstOrEnd && c == b']' {
                    stack.pop();
                    out.push(c);
                    i += 1;
                    state = State::AfterValue;
                } else {
                    if seen_value && stack.is_empty() {
                        return None;
                    }
                    let at_field = stack.len() == 1 && stack[0];
                    if at_field {
                        value_start = Some(out.len());
                    }
                    if !seen_value {
                        top_is_object = c == b'{';
                        seen_value = true;
                    }
                    match c {
                        b'{' => {
                            stack.push(true);
                            out.push(c);
                            i += 1;
                            state = State::ObjFirstOrEnd;
                            continue;
                        }
                        b'[' => {
                            stack.push(false);
                            out.push(c);
                            i += 1;
                            state = State::ArrFirstOrEnd;
                            continue;
                        }
                        b'"' => i = copy_string(input, i, &mut out)?,
                        b't' => i = copy_literal(input, i, b"true", &mut out)?,
                        b'f' => i = copy_literal(input, i, b"false", &mut out)?,
                        b'n' => i = copy_literal(input, i, b"null", &mut out)?,
                        b'-' | b'0'..=b'9' => i = copy_number(input, i, &mut out)?,
                        _ => return None,
                    }
                    state = State::AfterValue;
                }
            }
            State::ObjFirstOrEnd | State::ObjKey => {
                if state == State::ObjFirstOrEnd && c == b'}' {
                    stack.pop();
                    out.push(c);
                    i += 1;
                    state = State::AfterValue;
                } else if c == b'"' {
                    let start = out.len();
                    i = copy_string(input, i, &mut out)?;
                    if stack.len() == 1 {
                        key = Some(start..out.len());
                    }
                    state = State::ObjColon;
                    continue;
                } else {
                    return None;
                }
            }
            State::ObjColon => {
                if c != b':' {
                    return None;
                }
                out.push(c);
                i += 1;
                state = State::Value;
                continue;
            }
            State::AfterValue => {
                let Some(&in_object) = stack.last() else {
                    return None; // trailing data after the top-level value
                };
                match (c, in_object) {
                    (b',', true) => state = State::ObjKey,
                    (b',', false) => state = State::Value,
                    (b'}', true) | (b']', false) => {
                        stack.pop();
                        state = State::AfterValue;
                    }
                    _ => return None,
                }
                out.push(c);
                i += 1;
                // A top-level object closing does not complete a field.
                if c == b',' || stack.len() != 1 {
                    continue;
                }
            }
        }
        // A value just completed: record it if it is a field of the top-level object.
        if state == State::AfterValue && stack.len() == 1 && stack[0] {
            if let (Some(k), Some(v)) = (key.take(), value_start.take()) {
                fields.push((k, v..out.len()));
            }
        }
    }
    if !seen_value || state != State::AfterValue || !stack.is_empty() {
        return None;
    }
    Some(Scanned {
        compact: out,
        fields: if top_is_object { Some(fields) } else { None },
    })
}

fn copy_literal(input: &[u8], i: usize, lit: &[u8], out: &mut Vec<u8>) -> Option<usize> {
    if input.get(i..i + lit.len())? != lit {
        return None;
    }
    out.extend_from_slice(lit);
    Some(i + lit.len())
}

fn copy_number(input: &[u8], start: usize, out: &mut Vec<u8>) -> Option<usize> {
    let digits = |mut j: usize| {
        let from = j;
        while j < input.len() && input[j].is_ascii_digit() {
            j += 1;
        }
        (j, j - from)
    };
    let mut i = start;
    if input[i] == b'-' {
        i += 1;
    }
    match input.get(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => i = digits(i).0,
        _ => return None,
    }
    if input.get(i) == Some(&b'.') {
        let (j, count) = digits(i + 1);
        if count == 0 {
            return None;
        }
        i = j;
    }
    if matches!(input.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(input.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        let (j, count) = digits(i);
        if count == 0 {
            return None;
        }
        i = j;
    }
    out.extend_from_slice(&input[start..i]);
    Some(i)
}

/// Copies a string literal (quotes included); returns the index after the closing quote.
fn copy_string(input: &[u8], start: usize, out: &mut Vec<u8>) -> Option<usize> {
    let mut i = start + 1;
    loop {
        let c = *input.get(i)?;
        match c {
            b'"' => {
                i += 1;
                break;
            }
            b'\\' => match *input.get(i + 1)? {
                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => i += 2,
                b'u' => {
                    let hex = input.get(i + 2..i + 6)?;
                    if !hex.iter().all(u8::is_ascii_hexdigit) {
                        return None;
                    }
                    i += 6;
                }
                _ => return None,
            },
            0x00..=0x1f => return None,
            _ => i += 1,
        }
    }
    out.extend_from_slice(&input[start..i]);
    Some(i)
}

fn hex4(b: &[u8]) -> Option<u32> {
    std::str::from_utf8(b.get(..4)?)
        .ok()
        .and_then(|s| u32::from_str_radix(s, 16).ok())
}

/// Decodes a validated string literal (quotes included). A lone surrogate becomes U+FFFD.
pub fn decode_str(raw: &[u8]) -> String {
    let body = raw.get(1..raw.len().saturating_sub(1)).unwrap_or(&[]);
    let mut bytes: Vec<u8> = Vec::with_capacity(body.len());
    let mut i = 0;
    while i < body.len() {
        if body[i] != b'\\' {
            bytes.push(body[i]);
            i += 1;
            continue;
        }
        let esc = body.get(i + 1).copied().unwrap_or(b'\\');
        i += 2;
        let ch = match esc {
            b'b' => '\u{8}',
            b'f' => '\u{c}',
            b'n' => '\n',
            b'r' => '\r',
            b't' => '\t',
            b'u' => {
                let hi = hex4(body.get(i..).unwrap_or(&[])).unwrap_or(0xfffd);
                i += 4;
                if (0xd800..0xdc00).contains(&hi)
                    && body.get(i) == Some(&b'\\')
                    && body.get(i + 1) == Some(&b'u')
                {
                    match hex4(body.get(i + 2..).unwrap_or(&[])) {
                        Some(lo) if (0xdc00..0xe000).contains(&lo) => {
                            i += 6;
                            char::from_u32(0x10000 + ((hi - 0xd800) << 10) + (lo - 0xdc00))
                                .unwrap_or('\u{fffd}')
                        }
                        _ => '\u{fffd}',
                    }
                } else {
                    char::from_u32(hi).unwrap_or('\u{fffd}')
                }
            }
            other => other as char,
        };
        let mut buf = [0u8; 4];
        bytes.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// JSON string literal, escaped like `JSON.stringify`.
pub fn encode_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// JavaScript truthiness of a raw compact JSON value.
pub fn truthy(raw: &[u8]) -> bool {
    match raw.first() {
        None => false,
        Some(b'"') => raw.len() > 2,
        Some(b't' | b'{' | b'[') => true,
        Some(b'f' | b'n') => false,
        Some(_) => std::str::from_utf8(raw)
            .ok()
            .and_then(|s| s.parse::<f64>().ok())
            .is_some_and(|v| v != 0.0),
    }
}

/// `String(value)` for the spool file name.
pub fn js_string(raw: Option<&[u8]>) -> String {
    match raw {
        None => "undefined".into(),
        Some(r) if r.first() == Some(&b'"') => decode_str(r),
        Some(r) if r.first() == Some(&b'{') => "[object Object]".into(),
        Some(r) => String::from_utf8_lossy(r).into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compact(s: &str) -> Option<String> {
        scan(s.as_bytes()).map(|x| String::from_utf8(x.compact).unwrap())
    }

    #[test]
    fn accepts_what_json_parse_accepts() {
        for ok in [
            "0",
            "-0",
            "1.5e+3",
            "-12.0E-1",
            "true",
            "false",
            "null",
            "\"\"",
            "[]",
            "{}",
            " [1, [2, {\"a\": [ ]}]] ",
            "{\"a\":{\"b\":{\"c\":[1,2,{\"d\":null}]}}}",
            "\"\\ud800\"",
            "\"\\u00e9\\n\\\"\\\\\\/\"",
            "\"é😀\"",
        ] {
            assert!(scan(ok.as_bytes()).is_some(), "{ok}");
        }
    }

    #[test]
    fn rejects_invalid_json() {
        for bad in [
            "",
            " ",
            "{oups",
            "01",
            "1.",
            ".5",
            "-",
            "1e",
            "+1",
            "[1,]",
            "{\"a\":1,}",
            "{a:1}",
            "[1 2]",
            "{\"a\" 1}",
            "\"\\x\"",
            "\"\\u12\"",
            "\"a\nb\"",
            "tru",
            "nul",
            "1 2",
            "{}{}",
            "[",
            "]",
            "{\"a\":}",
            "'a'",
            "NaN",
        ] {
            assert!(scan(bad.as_bytes()).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn no_depth_limit() {
        let deep = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
        assert!(scan(deep.as_bytes()).is_some());
    }

    #[test]
    fn removes_whitespace_outside_strings_only() {
        assert_eq!(
            compact("{\n  \"a b\" : [ 1 ,\t2 ],\r\n \"c\": \" x \\n \" }\n").unwrap(),
            "{\"a b\":[1,2],\"c\":\" x \\n \"}"
        );
    }

    #[test]
    fn reads_top_level_fields() {
        let s = scan(br#"{"v":1,"id":"x","type":"save.create","payload":{"type":"inner","upload":{"n":1}},"type":"ping"}"#).unwrap();
        assert!(s.is_object());
        assert_eq!(s.str_field("type").as_deref(), Some("ping")); // last one wins
        assert_eq!(s.field("v"), Some(&b"1"[..]));
        assert_eq!(
            s.field("payload"),
            Some(&br#"{"type":"inner","upload":{"n":1}}"#[..])
        );
        assert_eq!(s.field("absent"), None);
        let p = scan(s.field("payload").unwrap()).unwrap();
        assert_eq!(p.str_field("type").as_deref(), Some("inner"));
        assert!(scan(b"[1]").map(|x| !x.is_object()).unwrap());
        assert_eq!(scan(br#"{"type":5}"#).unwrap().str_field("type"), None);
        let e = scan(br#"{"\u0074ype":"x","a":[{"type":"no"}]}"#).unwrap();
        assert_eq!(e.str_field("type").as_deref(), Some("x"));
    }

    #[test]
    fn decodes_and_encodes_strings() {
        assert_eq!(
            decode_str(br#""a\"\\\/\b\f\n\r\t\u00e9""#),
            "a\"\\/\u{8}\u{c}\n\r\té"
        );
        assert_eq!(decode_str(br#""\ud83d\ude00""#), "😀");
        assert_eq!(decode_str(br#""\ud83d""#), "\u{fffd}");
        assert_eq!(encode_str("a\"b\\c\n\u{1}é"), r#""a\"b\\c\n\u0001é""#);
    }

    #[test]
    fn javascript_truthiness() {
        for (raw, t) in [
            ("\"\"", false),
            ("\"x\"", true),
            ("0", false),
            ("-0", false),
            ("0.0e5", false),
            ("2", true),
            ("null", false),
            ("false", false),
            ("true", true),
            ("{}", true),
            ("[]", true),
        ] {
            assert_eq!(truthy(raw.as_bytes()), t, "{raw}");
        }
        assert_eq!(js_string(None), "undefined");
        assert_eq!(js_string(Some(b"\"ab\"")), "ab");
        assert_eq!(js_string(Some(b"12")), "12");
    }
}
