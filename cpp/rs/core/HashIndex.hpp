#pragma once

#include <cstddef>
#include <limits>

#include "Allocator.hpp"
#include "Result.hpp"
#include "Status.hpp"
#include "Vec.hpp"

namespace rs {

template <typename Key, typename Value, typename Hasher, typename Equals>
class HashIndex {
public:
    explicit HashIndex(Allocator& alloc = defaultAllocator()) noexcept
        : alloc_(&alloc), keys_(alloc), values_(alloc), states_(alloc) {}

    [[nodiscard]] std::size_t capacity() const noexcept { return states_.size(); }
    [[nodiscard]] std::size_t size() const noexcept { return size_; }
    [[nodiscard]] bool empty() const noexcept { return size_ == 0; }

    void clear() noexcept {
        for (std::size_t i = 0; i < states_.size(); i++) {
            states_[i] = 0;
        }
        size_ = 0;
    }

    Result<void> reserveForExpectedCount(std::size_t expectedCount) noexcept {
        const std::size_t minSlotCount = roundUpPow2AtLeast8(expectedCount * 2 + 1);
        return rehash(minSlotCount);
    }

    [[nodiscard]] bool find(const Key& key, Value* outValue = nullptr) const noexcept {
        if (states_.empty()) {
            return false;
        }
        const std::size_t mask = states_.size() - 1;
        std::size_t slot = static_cast<std::size_t>(hashKey(key)) & mask;
        for (std::size_t probe = 0; probe < states_.size(); probe++) {
            if (states_[slot] == 0) {
                return false;
            }
            if (equalKeys(keys_[slot], key)) {
                if (outValue) {
                    *outValue = values_[slot];
                }
                return true;
            }
            slot = (slot + 1) & mask;
        }
        return false;
    }

    Result<void> insertIfMissing(
        const Key& key,
        const Value& value,
        bool* outInserted = nullptr,
        Value* outExistingValue = nullptr) noexcept {
        if (outInserted) {
            *outInserted = false;
        }

        if (states_.empty()) {
            auto rr = reserveForExpectedCount(8);
            if (!rr.isOk()) {
                return rr;
            }
        }

        while ((size_ + 1) * 2 > states_.size()) {
            const std::size_t current = states_.size();
            const std::size_t grown = current > (std::numeric_limits<std::size_t>::max() >> 1)
                ? current
                : (current << 1);
            auto rr = rehash(grown);
            if (!rr.isOk()) {
                return rr;
            }
        }

        const std::size_t mask = states_.size() - 1;
        std::size_t slot = static_cast<std::size_t>(hashKey(key)) & mask;
        for (std::size_t probe = 0; probe < states_.size(); probe++) {
            if (states_[slot] == 0) {
                keys_[slot] = key;
                values_[slot] = value;
                states_[slot] = 1;
                size_++;
                if (outInserted) {
                    *outInserted = true;
                }
                return Result<void>::ok();
            }
            if (equalKeys(keys_[slot], key)) {
                if (outExistingValue) {
                    *outExistingValue = values_[slot];
                }
                return Result<void>::ok();
            }
            slot = (slot + 1) & mask;
        }

        return Result<void>::err(Status::OutOfRange);
    }

private:
    Allocator* alloc_ = nullptr;
    Vec<Key> keys_;
    Vec<Value> values_;
    Vec<unsigned char> states_;
    std::size_t size_ = 0;

    static std::size_t roundUpPow2AtLeast8(std::size_t v) noexcept {
        std::size_t out = 8;
        while (out < v && out < (std::numeric_limits<std::size_t>::max() >> 1)) {
            out <<= 1;
        }
        return out;
    }

    [[nodiscard]] static std::size_t hashKey(const Key& key) noexcept {
        return static_cast<std::size_t>(Hasher{}(key));
    }

    [[nodiscard]] static bool equalKeys(const Key& a, const Key& b) noexcept {
        return Equals{}(a, b);
    }

    Result<void> rehash(std::size_t requestedSlots) noexcept {
        const std::size_t newCap = roundUpPow2AtLeast8(requestedSlots);
        if (!alloc_) {
            return Result<void>::err(Status::InvalidArgument);
        }
        Vec<Key> newKeys(*alloc_);
        Vec<Value> newValues(*alloc_);
        Vec<unsigned char> newStates(*alloc_);

        auto rk = newKeys.resize(newCap);
        if (!rk.isOk()) {
            return Result<void>::err(rk.status());
        }
        auto rv = newValues.resize(newCap);
        if (!rv.isOk()) {
            return Result<void>::err(rv.status());
        }
        auto rs = newStates.resize(newCap);
        if (!rs.isOk()) {
            return Result<void>::err(rs.status());
        }
        for (std::size_t i = 0; i < newStates.size(); i++) {
            newStates[i] = 0;
        }

        for (std::size_t i = 0; i < states_.size(); i++) {
            if (states_[i] == 0) {
                continue;
            }
            const Key& key = keys_[i];
            const Value& value = values_[i];
            const std::size_t mask = newStates.size() - 1;
            std::size_t slot = static_cast<std::size_t>(hashKey(key)) & mask;
            bool inserted = false;
            for (std::size_t probe = 0; probe < newStates.size(); probe++) {
                if (newStates[slot] == 0) {
                    newKeys[slot] = key;
                    newValues[slot] = value;
                    newStates[slot] = 1;
                    inserted = true;
                    break;
                }
                if (equalKeys(newKeys[slot], key)) {
                    inserted = true;
                    break;
                }
                slot = (slot + 1) & mask;
            }
            if (!inserted) {
                return Result<void>::err(Status::OutOfRange);
            }
        }

        keys_ = rs::move(newKeys);
        values_ = rs::move(newValues);
        states_ = rs::move(newStates);
        return Result<void>::ok();
    }
};

} // namespace rs
