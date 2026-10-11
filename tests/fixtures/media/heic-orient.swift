// Fixture WP-03 : réécrit une image en HEIC avec une orientation (ImageIO), comme une photo
// d'iPhone tenue en portrait. Usage : swift heic-orient.swift <src> <dst.heic> <orientation>
import Foundation
import ImageIO

let args = CommandLine.arguments
guard args.count == 4, let orientation = Int(args[3]) else { exit(64) }
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else { exit(65) }
guard let dest = CGImageDestinationCreateWithURL(
  URL(fileURLWithPath: args[2]) as CFURL, "public.heic" as CFString, 1, nil)
else { exit(66) }
CGImageDestinationAddImage(dest, image, [kCGImagePropertyOrientation: orientation] as CFDictionary)
exit(CGImageDestinationFinalize(dest) ? 0 : 67)
