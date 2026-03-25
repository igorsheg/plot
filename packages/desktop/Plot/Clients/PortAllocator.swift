import Dependencies
import Foundation
import os

final class PortAllocator: Sendable {
    private let range: ClosedRange<UInt16> = 10300...10399
    private let allocated = OSAllocatedUnfairLock(initialState: Set<UInt16>())
    
    func allocate() -> UInt16? {
        allocated.withLock { (set: inout Set<UInt16>) -> UInt16? in
            for port in range where !set.contains(port) {
                set.insert(port)
                return port
            }
            return nil
        }
    }

    func release(_ port: UInt16) {
        allocated.withLock { $0.remove(port) }
    }
}

extension PortAllocator: DependencyKey {
    static let liveValue = PortAllocator()
}

extension DependencyValues {
    var portAllocator: PortAllocator {
        get { self[PortAllocator.self] }
        set { self[PortAllocator.self] = newValue }
    }
}
