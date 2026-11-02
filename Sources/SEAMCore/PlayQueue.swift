import Foundation

public enum RepeatMode: String, Codable, Sendable { case off, all, one }

/// Playback order logic, independent of any audio engine.
public struct PlayQueue<Item: Equatable & Sendable>: Sendable {
    public private(set) var items: [Item]
    public private(set) var currentIndex: Int?
    public var repeatMode: RepeatMode = .off

    public init(items: [Item] = [], startIndex: Int? = nil) {
        self.items = items
        self.currentIndex = items.isEmpty ? nil : min(max(startIndex ?? 0, 0), items.count - 1)
    }

    public var current: Item? { currentIndex.map { items[$0] } }

    /// Next index honouring repeat mode; `auto` is true for natural end-of-track advance.
    public func nextIndex(auto: Bool) -> Int? {
        guard let i = currentIndex else { return nil }
        if auto && repeatMode == .one { return i }
        if i + 1 < items.count { return i + 1 }
        return repeatMode == .all ? 0 : nil
    }

    @discardableResult
    public mutating func advance(auto: Bool) -> Item? {
        guard let n = nextIndex(auto: auto) else { return nil }
        currentIndex = n
        return current
    }

    @discardableResult
    public mutating func previous() -> Item? {
        guard let i = currentIndex else { return nil }
        if i > 0 { currentIndex = i - 1 } else if repeatMode == .all { currentIndex = items.count - 1 }
        return current
    }

    public mutating func move(from: Int, to: Int) {
        guard items.indices.contains(from), items.indices.contains(to), from != to else { return }
        let playing = currentIndex
        let item = items.remove(at: from)
        items.insert(item, at: to)
        guard let p = playing else { return }
        if p == from { currentIndex = to }
        else if from < p && to >= p { currentIndex = p - 1 }
        else if from > p && to <= p { currentIndex = p + 1 }
    }

    /// Shuffles upcoming items only; the current track stays first so playback is not interrupted.
    public mutating func shuffleUpcoming(using rng: inout some RandomNumberGenerator) {
        guard let i = currentIndex, i + 1 < items.count else { return }
        items[(i + 1)...].shuffle(using: &rng)
    }
}
