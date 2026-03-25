import Foundation

enum ProjectLifecycle: Equatable {
    case idle
    case launching
    case connecting
    case streaming
    case stopping
    case stopped
    case failed(String)

    var isActive: Bool {
        switch self {
        case .launching, .connecting, .streaming, .stopping: return true
        default: return false
        }
    }

    var label: String {
        switch self {
        case .idle: return "Idle"
        case .launching: return "Launching"
        case .connecting: return "Connecting"
        case .streaming: return "Running"
        case .stopping: return "Stopping"
        case .stopped: return "Stopped"
        case .failed: return "Error"
        }
    }
}
