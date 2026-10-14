//! Native messaging frames: `[u32 length, native order = little-endian on arm64][JSON UTF-8]`,
//! and NDJSON lines on the app socket. Same rules as `src/host/framing.ts`.

use crate::json;

#[cfg_attr(test, derive(Debug, PartialEq))]
pub enum DecodeEvent {
    /// Valid JSON body, already compacted.
    Message(json::Scanned),
    Invalid(&'static str),
    /// The stream must be closed (nothing more is decoded).
    Fatal(String),
}

#[cfg(test)]
impl std::fmt::Debug for json::Scanned {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", String::from_utf8_lossy(&self.compact))
    }
}

#[cfg(test)]
impl PartialEq for json::Scanned {
    fn eq(&self, other: &Self) -> bool {
        self.compact == other.compact
    }
}

/// Incremental decoder: accepts arbitrary chunks, returns complete messages.
pub struct FrameDecoder {
    pending: Vec<u8>,
    dead: bool,
    max_bytes: usize,
}

impl FrameDecoder {
    pub fn new(max_bytes: usize) -> Self {
        FrameDecoder {
            pending: Vec::new(),
            dead: false,
            max_bytes,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<DecodeEvent> {
        let mut out = Vec::new();
        if self.dead {
            return out;
        }
        self.pending.extend_from_slice(chunk);
        let mut start = 0;
        while self.pending.len() - start >= 4 {
            let head = &self.pending[start..start + 4];
            let len = u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize;
            if len == 0 || len > self.max_bytes {
                self.dead = true;
                self.pending = Vec::new();
                out.push(DecodeEvent::Fatal(if len == 0 {
                    "empty frame".into()
                } else {
                    format!("{len}-byte frame refused")
                }));
                return out;
            }
            if self.pending.len() - start < 4 + len {
                break;
            }
            let body = &self.pending[start + 4..start + 4 + len];
            out.push(match json::scan(body) {
                Some(s) => DecodeEvent::Message(s),
                None => DecodeEvent::Invalid("invalid JSON"),
            });
            start += 4 + len;
        }
        if start > 0 {
            self.pending.drain(..start);
        }
        out
    }
}

/// Frame for the extension; `None` beyond `max_bytes` (the browser would close the port).
pub fn encode_frame(body: &[u8], max_bytes: usize) -> Option<Vec<u8>> {
    if body.len() > max_bytes {
        return None;
    }
    let mut f = Vec::with_capacity(4 + body.len());
    f.extend_from_slice(&(body.len() as u32).to_le_bytes());
    f.extend_from_slice(body);
    Some(f)
}

/// NDJSON lines (host ↔ app socket): returns complete non-blank lines, `None` past the limit.
pub struct LineDecoder {
    acc: Vec<u8>,
    max_bytes: usize,
}

pub const MAX_LINE_BYTES: usize = 96 * 1024 * 1024;

impl LineDecoder {
    pub fn new(max_bytes: usize) -> Self {
        LineDecoder {
            acc: Vec::new(),
            max_bytes,
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Option<Vec<Vec<u8>>> {
        self.acc.extend_from_slice(chunk);
        if self.acc.len() > self.max_bytes {
            return None;
        }
        let mut lines = Vec::new();
        let mut start = 0;
        while let Some(pos) = self.acc[start..].iter().position(|&b| b == b'\n') {
            let line = &self.acc[start..start + pos];
            if !String::from_utf8_lossy(line).trim().is_empty() {
                lines.push(line.to_vec());
            }
            start += pos + 1;
        }
        if start > 0 {
            self.acc.drain(..start);
        }
        Some(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(s: &str) -> Vec<u8> {
        encode_frame(s.as_bytes(), usize::MAX).unwrap()
    }

    fn messages(evs: Vec<DecodeEvent>) -> Vec<String> {
        evs.into_iter()
            .map(|e| match e {
                DecodeEvent::Message(m) => String::from_utf8(m.compact).unwrap(),
                other => panic!("{other:?}"),
            })
            .collect()
    }

    #[test]
    fn rebuilds_messages_whatever_the_cuts() {
        let msgs = [
            r#"{"a":1}"#,
            "[1,2,3]",
            r#""é😀""#,
            "null",
            r#"{"b":{"c":[true,false]}}"#,
        ];
        let stream: Vec<u8> = msgs.iter().flat_map(|m| frame(m)).collect();
        for step in 1..stream.len() {
            let mut d = FrameDecoder::new(64 * 1024 * 1024);
            let mut got = Vec::new();
            for part in stream.chunks(step) {
                got.extend(messages(d.push(part)));
            }
            assert_eq!(got, msgs, "chunks of {step}");
        }
    }

    #[test]
    fn length_zero_is_a_clean_close() {
        let mut d = FrameDecoder::new(64 * 1024 * 1024);
        assert_eq!(
            d.push(&[0, 0, 0, 0, 1, 2, 3]),
            vec![DecodeEvent::Fatal("empty frame".into())]
        );
        assert!(d.push(&frame("{\"a\":1}")).is_empty());
    }

    #[test]
    fn oversized_length_is_a_clean_close() {
        let mut d = FrameDecoder::new(64 * 1024 * 1024);
        assert_eq!(
            d.push(&[0xff, 0xff, 0xff, 0xff]),
            vec![DecodeEvent::Fatal("4294967295-byte frame refused".into())]
        );
        assert!(d.push(&frame("1")).is_empty());
    }

    #[test]
    fn invalid_json_is_skipped_and_the_stream_continues() {
        let mut d = FrameDecoder::new(64 * 1024 * 1024);
        let mut bytes = frame("{oups");
        bytes.extend(frame("{ \"ok\" : true }"));
        let evs = d.push(&bytes);
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0], DecodeEvent::Invalid("invalid JSON"));
        assert_eq!(
            messages(evs.into_iter().skip(1).collect()),
            vec![r#"{"ok":true}"#]
        );
    }

    #[test]
    fn encode_frame_refuses_more_than_the_limit() {
        assert!(encode_frame(&vec![b'x'; 1024 * 1024 + 1], 1024 * 1024).is_none());
        let f = encode_frame(&vec![b'x'; 1008], 1024 * 1024).unwrap();
        assert_eq!(&f[..4], &1008u32.to_le_bytes());
    }

    #[test]
    fn ndjson_lines_cut_anywhere() {
        let mut d = LineDecoder::new(MAX_LINE_BYTES);
        assert_eq!(
            d.push(b"{\"a\":1}\n{\"b\"").unwrap(),
            vec![b"{\"a\":1}".to_vec()]
        );
        assert_eq!(d.push(b":2}\n\n  \n").unwrap(), vec![b"{\"b\":2}".to_vec()]);
        let mut small = LineDecoder::new(4);
        assert!(small.push(b"12345").is_none());
    }
}
