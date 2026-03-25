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
}
