// Records the default input (the Yeti X) to a 16-bit mono WAV at 48 kHz.
// Usage: rec <out.wav> <seconds>
// Made because ffmpeg's avfoundation input dropped ~75% of the samples.
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let seconds = Double(args[2]) else {
  FileHandle.standardError.write("usage: rec <out.wav> <seconds>\n".data(using: .utf8)!)
  exit(2)
}
let url = URL(fileURLWithPath: args[1])
let settings: [String: Any] = [
  AVFormatIDKey: kAudioFormatLinearPCM,
  AVSampleRateKey: 48000,
  AVNumberOfChannelsKey: 1,
  AVLinearPCMBitDepthKey: 16,
  AVLinearPCMIsFloatKey: false,
  AVLinearPCMIsBigEndianKey: false,
]
do {
  let recorder = try AVAudioRecorder(url: url, settings: settings)
  guard recorder.record() else {
    FileHandle.standardError.write("record() refused (microphone permission?)\n".data(using: .utf8)!)
    exit(1)
  }
  print("recording \(seconds)s")
  fflush(stdout)
  Thread.sleep(forTimeInterval: seconds)
  recorder.stop()
} catch {
  FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
  exit(1)
}
