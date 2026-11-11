import Darwin
import Foundation

// Per-process disk bytes over a window, via proc_pid_rusage (no root needed for own processes).
// Usage: diskio [seconds]
func snapshot() -> [Int32: (UInt64, UInt64)] {
    var pids = [Int32](repeating: 0, count: 8192)
    let n = proc_listallpids(&pids, Int32(pids.count * 4))
    var out: [Int32: (UInt64, UInt64)] = [:]
    for pid in pids.prefix(Int(n)) where pid > 0 {
        var info = rusage_info_v4()
        let rc = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V4, $0) }
        }
        if rc == 0 { out[pid] = (info.ri_diskio_bytesread, info.ri_diskio_byteswritten) }
    }
    return out
}

func name(_ pid: Int32) -> String {
    var buf = [CChar](repeating: 0, count: 4096)
    proc_pidpath(pid, &buf, UInt32(buf.count))
    return (String(cString: buf) as NSString).lastPathComponent
}

let secs = Double(CommandLine.arguments.dropFirst().first ?? "30") ?? 30
let a = snapshot()
Thread.sleep(forTimeInterval: secs)
let b = snapshot()
var rows: [(Double, Double, Int32)] = []
for (pid, (r1, w1)) in b {
    guard let (r0, w0) = a[pid] else { continue }
    let r = Double(r1 &- r0) / 1e6 / secs
    let w = Double(w1 &- w0) / 1e6 / secs
    if r + w > 0.01 { rows.append((r, w, pid)) }
}
rows.sort { $0.0 + $0.1 > $1.0 + $1.1 }
print("read MB/s  write MB/s     PID  COMMAND")
for (r, w, pid) in rows.prefix(15) {
    print(String(format: "%9.2f  %10.2f  %6d  %@", r, w, pid, name(pid)))
}
