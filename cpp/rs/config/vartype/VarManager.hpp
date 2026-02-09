#pragma once

#include "../../core/Allocator.hpp"
#include "../../core/Span.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../types.hpp"
#include "../questtype/QuestTypeLoader.hpp"
#include "VarBitType.hpp"

namespace rs {

// Mirrors src/rs/config/vartype/VarManager.ts behavior.
struct VarManager final {
    static constexpr i32 kDefaultVarCount = 8000;

    Vec<i32> values{};

    explicit VarManager(Allocator& alloc = defaultAllocator()) noexcept
        : values(alloc) {}

    Status init(i32 count = kDefaultVarCount) noexcept {
        if (count < 0) return Status::InvalidArgument;
        auto rr = values.resize(static_cast<std::size_t>(count));
        if (!rr.isOk()) return rr.status();
        clear();
        return Status::Ok;
    }

    void clear() noexcept {
        for (std::size_t i = 0; i < values.size(); i++) {
            values[i] = 0;
        }
    }

    Status set(Span<const i32> nextValues) noexcept {
        if (nextValues.size() > values.size()) {
            return Status::OutOfRange;
        }
        for (std::size_t i = 0; i < nextValues.size(); i++) {
            values[i] = nextValues[i];
        }
        return Status::Ok;
    }

    [[nodiscard]] i32 getVarp(i32 id) const noexcept {
        if (id < 0) return 0;
        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx >= values.size()) return 0;
        return values[idx];
    }

    bool setVarp(i32 id, i32 value) noexcept {
        if (id < 0) return false;
        const std::size_t idx = static_cast<std::size_t>(id);
        if (idx >= values.size()) return false;
        if (values[idx] == value) return false;
        values[idx] = value;
        return true;
    }

    template <typename TryGetVarBitFn>
    [[nodiscard]] i32 getVarbit(i32 id, TryGetVarBitFn&& tryGetVarBitType) const noexcept {
        const VarBitType* varbit = nullptr;
        const Status s = tryGetVarBitType(id, &varbit);
        if (!ok(s) || !varbit) {
            return 0;
        }
        if (varbit->baseVar < 0 || static_cast<std::size_t>(varbit->baseVar) >= values.size()) {
            return 0;
        }

        const i32 startBit = clampBitIndex(varbit->startBit);
        const i32 endBit = clampBitIndex(varbit->endBit);
        const i32 width = endBit - startBit;
        if (width < 0) {
            return 0;
        }

        const i32 mask = bitMaskForWidth(width);
        return (values[static_cast<std::size_t>(varbit->baseVar)] >> startBit) & mask;
    }

    template <typename TryGetVarBitFn>
    bool setVarbit(i32 id, i32 value, TryGetVarBitFn&& tryGetVarBitType) noexcept {
        const VarBitType* varbit = nullptr;
        const Status s = tryGetVarBitType(id, &varbit);
        if (!ok(s) || !varbit) {
            return false;
        }
        if (varbit->baseVar < 0 || static_cast<std::size_t>(varbit->baseVar) >= values.size()) {
            return false;
        }

        const i32 startBit = clampBitIndex(varbit->startBit);
        const i32 endBit = clampBitIndex(varbit->endBit);
        const i32 width = endBit - startBit;
        if (width < 0) {
            return false;
        }

        i32 mask = bitMaskForWidth(width);
        if (value < 0 || value > mask) {
            value = 0;
        }
        if (getVarbit(id, tryGetVarBitType) == value) {
            return false;
        }

        mask <<= startBit;
        const std::size_t baseVar = static_cast<std::size_t>(varbit->baseVar);
        values[baseVar] = ((value << startBit) & mask) | (values[baseVar] & ~mask);
        return true;
    }

    template <typename TryGetVarBitFn>
    void setQuestsCompleted(const QuestTypeLoader& questTypeLoader, TryGetVarBitFn&& tryGetVarBitType) noexcept {
        for (i32 i = 0; i < questTypeLoader.count(); i++) {
            const QuestType* quest = nullptr;
            const Status s = questTypeLoader.get(i, &quest);
            if (!ok(s) || !quest) continue;

            for (std::size_t vi = 0; vi < quest->varps.size(); vi++) {
                const QuestVar& v = quest->varps[vi];
                setVarp(v.id, v.completedValue);
            }
            for (std::size_t vi = 0; vi < quest->varbits.size(); vi++) {
                const QuestVar& v = quest->varbits[vi];
                setVarbit(v.id, v.completedValue, tryGetVarBitType);
            }
        }
    }

private:
    static i32 clampBitIndex(i32 bit) noexcept {
        if (bit < 0) return 0;
        if (bit > 31) return 31;
        return bit;
    }

    // Matches TS `BIT_MASKS[i] = (2 << i) - 1` Int32 behavior.
    static i32 bitMaskForWidth(i32 width) noexcept {
        if (width < 0) return 0;
        if (width > 31) width = 31;
        const u32 shifted = static_cast<u32>(2u) << static_cast<u32>(width);
        return static_cast<i32>(shifted) - 1;
    }
};

} // namespace rs
