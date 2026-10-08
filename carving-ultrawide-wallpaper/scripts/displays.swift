// displays.swift — enumerate macOS displays and set per-display wallpaper.
//
//   swift displays.swift list
//       Prints one TSV row per display:
//         id <TAB> name <TAB> ox <TAB> oy <TAB> w <TAB> h <TAB> seamlessCrop(WxH+X+Y)
//       plus `bbox=WxH` on stderr. The seamless crop is the display's true
//       window into a canvas sized to the whole arrangement's bounding box.
//
//   swift displays.swift set <id> <file> [<id> <file> ...]
//       Sets each display (matched by CGDirectDisplayID) to its image file.
//
// Why id-based: display *names* can collide ("LG SDQHD (1)/(2)") and the (1)/(2)
// suffixes are enumeration order, NOT physical left/right. Position and id are
// the only reliable keys.

import AppKit
import Foundation

func screenNum(_ s: NSScreen) -> UInt32 {
  (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
}

let args = CommandLine.arguments
let cmd = args.count > 1 ? args[1] : "list"
let screens = NSScreen.screens

switch cmd {
case "list":
  // macOS screen coords: origin bottom-left of the main display, y grows UP.
  // Map to image space (y grows DOWN from the arrangement top):
  //   crop_x = screen.minX - arrangement.minX
  //   crop_y = arrangement.maxY(top) - screen.maxY(its top)
  let minX = screens.map { $0.frame.minX }.min() ?? 0
  let maxX = screens.map { $0.frame.maxX }.max() ?? 0
  let minY = screens.map { $0.frame.minY }.min() ?? 0
  let maxTop = screens.map { $0.frame.maxY }.max() ?? 0
  for s in screens {
    let f = s.frame
    let w = Int(f.width), h = Int(f.height)
    let cropX = Int(f.minX - minX)
    let cropY = Int(maxTop - f.maxY)
    let crop = "\(w)x\(h)+\(cropX)+\(cropY)"
    print("\(screenNum(s))\t\(s.localizedName)\t\(Int(f.minX))\t\(Int(f.minY))\t\(w)\t\(h)\t\(crop)")
  }
  let bbox = "bbox=\(Int(maxX - minX))x\(Int(maxTop - minY))\n"
  FileHandle.standardError.write(bbox.data(using: .utf8)!)

case "set":
  let rest = Array(args.dropFirst(2))
  guard rest.count >= 2, rest.count % 2 == 0 else {
    FileHandle.standardError.write("usage: displays.swift set <id> <file> [<id> <file> ...]\n".data(using: .utf8)!)
    exit(2)
  }
  let byId = Dictionary(screens.map { (screenNum($0), $0) }, uniquingKeysWith: { a, _ in a })
  let ws = NSWorkspace.shared
  var i = 0
  var failures = 0
  while i + 1 < rest.count {
    let idStr = rest[i], path = rest[i + 1]
    i += 2
    guard let id = UInt32(idStr), let screen = byId[id] else {
      print("❌ unknown display id \(idStr)"); failures += 1; continue
    }
    do {
      try ws.setDesktopImageURL(URL(fileURLWithPath: path), for: screen, options: [:])
      print("✅ \(id)  \"\(screen.localizedName)\"  <- \(path)")
    } catch {
      print("❌ \(id) \"\(screen.localizedName)\": \(error.localizedDescription)"); failures += 1
    }
  }
  exit(failures == 0 ? 0 : 1)

default:
  FileHandle.standardError.write("usage: displays.swift [list | set <id> <file> ...]\n".data(using: .utf8)!)
  exit(2)
}
