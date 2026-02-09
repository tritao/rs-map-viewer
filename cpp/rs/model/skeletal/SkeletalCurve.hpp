#pragma once

#include <cmath>

#include "../../core/Allocator.hpp"
#include "../../core/Status.hpp"
#include "../../core/Vec.hpp"
#include "../../io/Uint8ArrayReader.hpp"
#include "../../types.hpp"

namespace rs {

enum class CurveInterpType : i32 {
    TYPE_0 = 0,
    TYPE_1 = 1,
    TYPE_2 = 2,
    TYPE_3 = 3,
    TYPE_4 = 4,
};

inline CurveInterpType getCurveInterpTypeForId(i32 id) noexcept {
    if (id < 0 || id > 4) {
        return CurveInterpType::TYPE_0;
    }
    return static_cast<CurveInterpType>(id);
}

inline i32 getSkeletalCurveIndex(i32 typeId) noexcept {
    static constexpr i32 kCurveIndices[17] = {-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 0};
    if (typeId < 0 || typeId >= 17) {
        return -1;
    }
    return kCurveIndices[static_cast<std::size_t>(typeId)];
}

struct SkeletalCurvePoint final {
    i32 x = 0;
    float y = 0.0f;
    float inTangentDx = 0.0f;
    float inTangentDy = 0.0f;
    float outTangentDx = 0.0f;
    float outTangentDy = 0.0f;
    i32 nextIndex = -1;
};

struct SkeletalCurve final {
    i32 id = 0;
    i32 type = 0;
    CurveInterpType startInterpType = CurveInterpType::TYPE_0;
    CurveInterpType endInterpType = CurveInterpType::TYPE_0;
    bool boolFlag = false;

    Vec<SkeletalCurvePoint> points{};

    i32 startTick = 0;
    i32 endTick = 0;
    Vec<float> values{};
    float minValue = 0.0f;
    float maxValue = 0.0f;

    bool noInterp = false;

    i32 pointIndex = 0;
    bool pointIndexUpdated = true;

    bool interpBool = false;
    double interpV0 = 0.0;
    double interpV1 = 0.0;
    double interpV2 = 0.0;
    double interpV3 = 0.0;
    double interpV4 = 0.0;
    double interpV5 = 0.0;
    double interpV6 = 0.0;
    double interpV7 = 0.0;
    double interpV8 = 0.0;
    double interpV9 = 0.0;

    explicit SkeletalCurve(i32 curveId = 0, Allocator& alloc = defaultAllocator()) noexcept
        : id(curveId),
          points(alloc),
          values(alloc) {}
};

inline i32 skeletalCurvePointCount(const SkeletalCurve& curve) noexcept {
    return static_cast<i32>(curve.points.size());
}

inline i32 skeletalCurveTickDuration(const SkeletalCurve& curve) noexcept {
    return curve.endTick - curve.startTick;
}

inline float evaluateCurvePolynomial(const float* coeffs, i32 degree, float x) noexcept {
    float out = coeffs[static_cast<std::size_t>(degree)];
    for (i32 i = degree - 1; i >= 0; i--) {
        out = out * x + coeffs[static_cast<std::size_t>(i)];
    }
    return out;
}

inline void clampBezierControlX01InPlace(float* c0, float* c1) noexcept {
    if (!c0 || !c1) return;
    constexpr float kUlp = 1.1920929e-7f;
    float v0 = *c0;
    float v1 = *c1;
    v1 = 1.0f - v1;

    if (v0 < 0.0f) v0 = 0.0f;
    if (v1 < 0.0f) v1 = 0.0f;

    if (v0 > 1.0f || v1 > 1.0f) {
        const float constraint = 1.0f + v0 * (v0 - 2.0f + v1) + (v1 - 2.0f) * v1;
        if (constraint + kUlp > 0.0f) {
            if (kUlp + v0 < 1.3333334f) {
                const float a = v0 - 2.0f;
                const float b = v0 - 1.0f;
                const float sqrtTerm = std::sqrt(a * a - 4.0f * b * b);
                const float upperY = 0.5f * (sqrtTerm + -a);
                if (v1 + kUlp > upperY) {
                    v1 = upperY - kUlp;
                } else {
                    const float lowerY = (-a - sqrtTerm) * 0.5f;
                    if (v1 < lowerY + kUlp) {
                        v1 = lowerY + kUlp;
                    }
                }
            } else {
                v0 = 1.3333334f - kUlp;
                v1 = 0.33333334f - kUlp;
            }
        }
    }

    v1 = 1.0f - v1;
    *c0 = v0;
    *c1 = v1;
}

inline i32 findPolynomialRootsInInterval(
    const float* coeffs,
    i32 degree,
    float minX,
    bool minInclusive,
    float maxX,
    bool maxInclusive,
    float* rootsOut) noexcept {
    constexpr float kUlp = 1.1920929e-7f;
    constexpr float kUlp2 = 2.0f * kUlp;

    if (!coeffs || !rootsOut) return -1;
    if (degree < 0 || degree > 3) return -1;

    float coeffAbsSum = 0.0f;
    for (i32 i = 0; i <= degree; i++) {
        coeffAbsSum += std::fabs(coeffs[static_cast<std::size_t>(i)]);
    }

    const float eps = (std::fabs(minX) + std::fabs(maxX)) * static_cast<float>(degree + 1) * kUlp;
    if (coeffAbsSum <= eps) {
        return -1;
    }

    float normalized[4]{};
    const float invCoeffAbs = 1.0f / coeffAbsSum;
    for (i32 i = 0; i <= degree; i++) {
        normalized[static_cast<std::size_t>(i)] = coeffs[static_cast<std::size_t>(i)] * invCoeffAbs;
    }

    while (degree > 0 && std::fabs(normalized[static_cast<std::size_t>(degree)]) < eps) {
        degree--;
    }

    i32 rootCount = 0;
    if (degree == 0) {
        return 0;
    }

    if (degree == 1) {
        rootsOut[0] = -normalized[0] / normalized[1];
        const bool minOk = minInclusive ? minX < rootsOut[0] + eps : minX < rootsOut[0] - eps;
        const bool maxOk = maxInclusive ? maxX > rootsOut[0] - eps : maxX > rootsOut[0] + eps;
        rootCount = (minOk && maxOk) ? 1 : 0;
        if (rootCount > 0) {
            if (minInclusive && rootsOut[0] < minX) rootsOut[0] = minX;
            if (maxInclusive && rootsOut[0] > maxX) rootsOut[0] = maxX;
        }
        return rootCount;
    }

    float derivativeCoeffs[4]{};
    for (i32 i = 1; i <= degree; i++) {
        derivativeCoeffs[static_cast<std::size_t>(i - 1)] =
            static_cast<float>(i) * normalized[static_cast<std::size_t>(i)];
    }

    float derivativeRoots[5]{};
    const i32 derivativeRootCount = findPolynomialRootsInInterval(
        derivativeCoeffs,
        degree - 1,
        minX,
        false,
        maxX,
        false,
        derivativeRoots);
    if (derivativeRootCount == -1) {
        return 0;
    }

    bool prevWasRoot = false;
    float fLeft = 0.0f;
    float fRight = 0.0f;
    float rightX = 0.0f;

    for (i32 s = 0; s <= derivativeRootCount; s++) {
        if (rootCount > degree) return rootCount;

        float leftX = 0.0f;
        if (s == 0) {
            leftX = minX;
            fLeft = evaluateCurvePolynomial(normalized, degree, minX);
            if (std::fabs(fLeft) <= eps && minInclusive) {
                rootsOut[rootCount++] = minX;
            }
        } else {
            leftX = rightX;
            fLeft = fRight;
        }

        if (s == derivativeRootCount) {
            rightX = maxX;
            prevWasRoot = false;
        } else {
            rightX = derivativeRoots[static_cast<std::size_t>(s)];
        }

        fRight = evaluateCurvePolynomial(normalized, degree, rightX);
        if (prevWasRoot) {
            prevWasRoot = false;
            continue;
        }

        if (std::fabs(fRight) < eps) {
            if (s != derivativeRootCount || maxInclusive) {
                rootsOut[rootCount++] = rightX;
                prevWasRoot = true;
            }
            continue;
        }

        if (!((fLeft < 0.0f && fRight > 0.0f) || (fLeft > 0.0f && fRight < 0.0f))) {
            continue;
        }

        const i32 rootIndex = rootCount++;
        float a = leftX;
        float b = rightX;
        float fa = evaluateCurvePolynomial(normalized, degree, leftX);
        float root = 0.0f;

        if (std::fabs(fa) < kUlp) {
            root = leftX;
        } else {
            float fb = evaluateCurvePolynomial(normalized, degree, rightX);
            if (std::fabs(fb) < kUlp) {
                root = rightX;
            } else {
                float c = 0.0f;
                float d = 0.0f;
                float e = 0.0f;
                float fc = 0.0f;
                bool needsInit = true;
                bool loop = true;
                while (loop) {
                    loop = false;
                    if (needsInit) {
                        c = a;
                        fc = fa;
                        d = b - a;
                        e = d;
                        needsInit = false;
                    }

                    if (std::fabs(fc) < std::fabs(fb)) {
                        // Intentionally mirrors TS aliasing semantics:
                        // a=b; b=c; c=a; fa=fb; fb=fc; fc=fa;
                        // This is not a mathematically "clean" swap, but parity requires it.
                        a = b;
                        b = c;
                        c = a;
                        fa = fb;
                        fb = fc;
                        fc = fa;
                    }

                    const float tol = kUlp2 * std::fabs(b);
                    const float m = 0.5f * (c - b);
                    if (!(std::fabs(m) > tol && fb != 0.0f)) {
                        break;
                    }

                    if (std::fabs(e) < tol || std::fabs(fa) <= std::fabs(fb)) {
                        d = m;
                        e = m;
                    } else {
                        const float sRatio = fb / fa;
                        float p = 0.0f;
                        float q = 0.0f;
                        if (a == c) {
                            p = m * 2.0f * sRatio;
                            q = 1.0f - sRatio;
                        } else {
                            q = fa / fc;
                            const float r = fb / fc;
                            p = sRatio * (m * 2.0f * q * (q - r) - (r - 1.0f) * (b - a));
                            q = (r - 1.0f) * (q - 1.0f) * (sRatio - 1.0f);
                        }
                        if (p > 0.0f) {
                            q = -q;
                        } else {
                            p = -p;
                        }

                        const float prevE = e;
                        e = d;
                        if (2.0f * p < 3.0f * m * q - std::fabs(q * tol) &&
                            p < std::fabs(q * prevE * 0.5f)) {
                            d = p / q;
                        } else {
                            d = m;
                            e = m;
                        }
                    }

                    a = b;
                    fa = fb;
                    if (std::fabs(d) > tol) {
                        b += d;
                    } else if (m > 0.0f) {
                        b += tol;
                    } else {
                        b -= tol;
                    }
                    fb = evaluateCurvePolynomial(normalized, degree, b);
                    if (fb * (fc / std::fabs(fc)) > 0.0f) {
                        needsInit = true;
                        loop = true;
                    } else {
                        loop = true;
                    }
                }
                root = b;
            }
        }

        rootsOut[static_cast<std::size_t>(rootIndex)] = root;
        if (rootCount > 1 &&
            rootsOut[static_cast<std::size_t>(rootCount - 2)] >=
                rootsOut[static_cast<std::size_t>(rootCount - 1)] - eps) {
            rootsOut[static_cast<std::size_t>(rootCount - 2)] =
                0.5f * (rootsOut[static_cast<std::size_t>(rootCount - 2)] +
                        rootsOut[static_cast<std::size_t>(rootCount - 1)]);
            rootCount--;
        }
    }

    return rootCount;
}

inline float interpolateBezierSegment(const SkeletalCurve& curve, i32 t) noexcept {
    double v0 = 0.0;
    if (curve.interpV0 == static_cast<double>(t)) {
        v0 = 0.0;
    } else if (curve.interpV1 == static_cast<double>(t)) {
        v0 = 1.0;
    } else {
        v0 = (static_cast<double>(t) - curve.interpV0) / (curve.interpV1 - curve.interpV0);
    }

    double v1 = 0.0;
    if (curve.interpBool) {
        v1 = v0;
    } else {
        float coeffs[4]{};
        float roots[5]{};
        coeffs[3] = static_cast<float>(curve.interpV5);
        coeffs[2] = static_cast<float>(curve.interpV4);
        coeffs[1] = static_cast<float>(curve.interpV3);
        coeffs[0] = static_cast<float>(curve.interpV2 - v0);
        const i32 rootCount = findPolynomialRootsInInterval(
            coeffs,
            3,
            0.0f,
            true,
            1.0f,
            true,
            roots);
        if (rootCount == 1) {
            v1 = static_cast<double>(roots[0]);
        }
    }

    const double y =
        v1 * (curve.interpV7 + v1 * (v1 * curve.interpV9 + curve.interpV8)) + curve.interpV6;
    return static_cast<float>(y);
}

inline i32 skeletalCurveGetPointIndex(SkeletalCurve* curve, i32 t) noexcept {
    if (!curve) return -1;
    if (curve->points.empty()) return curve->pointIndex;

    bool needsSearch = false;
    if (curve->pointIndex < 0 || static_cast<std::size_t>(curve->pointIndex) >= curve->points.size()) {
        needsSearch = true;
    } else {
        const SkeletalCurvePoint& point = curve->points[static_cast<std::size_t>(curve->pointIndex)];
        const i32 nextIndex = point.nextIndex;
        needsSearch = point.x > t ||
                      (nextIndex >= 0 &&
                       static_cast<std::size_t>(nextIndex) < curve->points.size() &&
                       curve->points[static_cast<std::size_t>(nextIndex)].x <= t);
    }

    if (!needsSearch) {
        return curve->pointIndex;
    }

    if (t < curve->startTick || t > curve->endTick) {
        return -1;
    }

    const i32 pointCount = static_cast<i32>(curve->points.size());
    i32 newPointIndex = curve->pointIndex;
    if (pointCount > 0) {
        i32 startPointIndex = 0;
        i32 endPointIndex = pointCount - 1;
        while (startPointIndex <= endPointIndex) {
            const i32 pointIndex = (startPointIndex + endPointIndex) >> 1;
            const SkeletalCurvePoint& p = curve->points[static_cast<std::size_t>(pointIndex)];
            if (t < p.x) {
                if (pointIndex > 0 && t > curve->points[static_cast<std::size_t>(pointIndex - 1)].x) {
                    newPointIndex = pointIndex - 1;
                    break;
                }
                endPointIndex = pointIndex - 1;
            } else {
                if (t <= p.x) {
                    newPointIndex = pointIndex;
                    break;
                }
                if (pointIndex + 1 < pointCount &&
                    t < curve->points[static_cast<std::size_t>(pointIndex + 1)].x) {
                    newPointIndex = pointIndex;
                    break;
                }
                startPointIndex = pointIndex + 1;
            }
        }
    }

    if (curve->pointIndex != newPointIndex) {
        curve->pointIndex = newPointIndex;
        curve->pointIndexUpdated = true;
    }
    return curve->pointIndex;
}

inline const SkeletalCurvePoint* skeletalCurveGetPoint(SkeletalCurve* curve, i32 t) noexcept {
    if (!curve) return nullptr;
    if (curve->points.empty()) return nullptr;
    const i32 index = skeletalCurveGetPointIndex(curve, t);
    if (index < 0 || static_cast<std::size_t>(index) >= curve->points.size()) {
        return nullptr;
    }
    return &curve->points[static_cast<std::size_t>(index)];
}

inline float interpolateCurve(SkeletalCurve* curve, i32 t);

inline float extrapolateCurve(SkeletalCurve* curve, i32 t, bool isStart) noexcept {
    if (!curve || curve->points.empty()) return 0.0f;

    const float startX = static_cast<float>(curve->points[0].x);
    const float endX = static_cast<float>(curve->points[curve->points.size() - 1].x);
    const float rangeX = endX - startX;
    if (rangeX == 0.0f) return curve->points[0].y;

    float normalizedPos = 0.0f;
    if (static_cast<float>(t) > endX) {
        normalizedPos = (static_cast<float>(t) - endX) / rangeX;
    } else {
        normalizedPos = (static_cast<float>(t) - startX) / rangeX;
    }

    i32 cycleCount = static_cast<i32>(normalizedPos);
    float cycleFrac = std::fabs(normalizedPos - static_cast<float>(cycleCount));
    float mappedT = cycleFrac * rangeX;
    cycleCount = static_cast<i32>(std::fabs(1.0f + static_cast<float>(cycleCount)));
    const float halfCycles = static_cast<float>(cycleCount) / 2.0f;
    const i32 halfCyclesInt = static_cast<i32>(halfCycles);
    const float pingPongPhase = halfCycles - static_cast<float>(halfCyclesInt);

    if (isStart) {
        if (curve->startInterpType == CurveInterpType::TYPE_4) {
            if (pingPongPhase != 0.0f) mappedT += startX;
            else mappedT = endX - mappedT;
        } else if (curve->startInterpType == CurveInterpType::TYPE_2 ||
                   curve->startInterpType == CurveInterpType::TYPE_3) {
            mappedT = endX - mappedT;
        } else if (curve->startInterpType == CurveInterpType::TYPE_1) {
            mappedT = startX - static_cast<float>(t);
            const float tangentDx = curve->points[0].inTangentDx;
            const float tangentDy = curve->points[0].inTangentDy;
            float out = curve->points[0].y;
            if (tangentDx != 0.0f) out -= (mappedT * tangentDy) / tangentDx;
            return out;
        }
    } else {
        if (curve->endInterpType == CurveInterpType::TYPE_4) {
            if (pingPongPhase != 0.0f) mappedT = endX - mappedT;
            else mappedT += startX;
        } else if (curve->endInterpType == CurveInterpType::TYPE_2 ||
                   curve->endInterpType == CurveInterpType::TYPE_3) {
            mappedT += startX;
        } else if (curve->endInterpType == CurveInterpType::TYPE_1) {
            mappedT = static_cast<float>(t) - endX;
            const std::size_t last = curve->points.size() - 1;
            const float tangentDx = curve->points[last].outTangentDx;
            const float tangentDy = curve->points[last].outTangentDy;
            float out = curve->points[last].y;
            if (tangentDx != 0.0f) out += (tangentDy * mappedT) / tangentDx;
            return out;
        }
    }

    float out = interpolateCurve(curve, static_cast<i32>(mappedT));
    const float cycleDeltaY = curve->points[curve->points.size() - 1].y - curve->points[0].y;
    if (isStart && curve->startInterpType == CurveInterpType::TYPE_3) {
        out -= cycleDeltaY * static_cast<float>(cycleCount);
    } else if (!isStart && curve->endInterpType == CurveInterpType::TYPE_3) {
        out += cycleDeltaY * static_cast<float>(cycleCount);
    }
    return out;
}

inline float interpolateCurve(SkeletalCurve* curve, i32 t) {
    constexpr float kFloatMax = 3.4028234663852886e38f;
    if (!curve || curve->points.empty()) {
        return 0.0f;
    }
    if (t < curve->startTick) {
        if (curve->startInterpType == CurveInterpType::TYPE_0) return curve->points[0].y;
        return extrapolateCurve(curve, t, true);
    }
    if (t > curve->endTick) {
        if (curve->endInterpType == CurveInterpType::TYPE_0) return curve->points[curve->points.size() - 1].y;
        return extrapolateCurve(curve, t, false);
    }
    if (curve->noInterp) {
        return curve->points[0].y;
    }

    const SkeletalCurvePoint* point = skeletalCurveGetPoint(curve, t);
    if (!point) return 0.0f;

    bool useCurrentY = false;
    bool useNextY = false;
    if (point->outTangentDx == 0.0f && point->outTangentDy == 0.0f) {
        useCurrentY = true;
    } else if (point->outTangentDx == kFloatMax && point->outTangentDy == kFloatMax) {
        useNextY = true;
    } else if (point->nextIndex < 0 ||
               static_cast<std::size_t>(point->nextIndex) >= curve->points.size()) {
        useCurrentY = true;
    } else if (curve->pointIndexUpdated) {
        const SkeletalCurvePoint& next = curve->points[static_cast<std::size_t>(point->nextIndex)];
        const double x0 = static_cast<double>(point->x);
        const double y0 = static_cast<double>(point->y);
        const double c1x = static_cast<double>(point->outTangentDx) * 0.33333334 + x0;
        const double c1y = static_cast<double>(point->outTangentDy) * 0.33333334 + y0;
        const double x1 = static_cast<double>(next.x);
        const double y1 = static_cast<double>(next.y);
        const double c2x = x1 - static_cast<double>(next.inTangentDx) * 0.33333334;
        const double c2y = y1 - static_cast<double>(next.inTangentDy) * 0.33333334;

        if (curve->boolFlag) {
            float adjC1y = static_cast<float>(c1y);
            float adjC2y = static_cast<float>(c2y);
            const double dx = x1 - x0;
            if (dx != 0.0) {
                float controlX0 = static_cast<float>((c1x - x0) / dx);
                float controlX1 = static_cast<float>((c2x - x0) / dx);
                curve->interpBool = (controlX0 == 0.33333334f && controlX1 == 0.6666667f);

                const float origX0 = controlX0;
                const float origX1 = controlX1;
                if (controlX0 < 0.0f) controlX0 = 0.0f;
                if (controlX1 > 1.0f) controlX1 = 1.0f;
                if (controlX0 > 1.0f || controlX1 < -1.0f) {
                    clampBezierControlX01InPlace(&controlX0, &controlX1);
                }

                if (controlX0 != origX0 && origX0 != 0.0f) {
                    adjC1y = ((c1y - y0) * controlX0) / origX0 + y0;
                }
                if (controlX1 != origX1 && origX1 != 1.0f) {
                    adjC2y = y1 - ((1.0f - controlX1) * (y1 - c2y)) / (1.0f - origX1);
                }

                curve->interpV0 = x0;
                curve->interpV1 = x1;
                float a = controlX0;
                float b = controlX1 - controlX0;
                float c = 1.0f - controlX1;
                float d = b - a;
                curve->interpV5 = static_cast<double>(c - b - d);
                curve->interpV4 = static_cast<double>(d + d + d);
                curve->interpV3 = static_cast<double>(a + a + a);
                curve->interpV2 = 0.0;

                a = adjC1y - static_cast<float>(y0);
                b = adjC2y - adjC1y;
                c = static_cast<float>(y1) - adjC2y;
                d = b - a;
                curve->interpV9 = static_cast<double>(c - b - d);
                curve->interpV8 = static_cast<double>(d + d + d);
                curve->interpV7 = static_cast<double>(a + a + a);
                curve->interpV6 = y0;
            }
        } else {
            curve->interpV0 = x0;
            const double dx = x1 - x0;
            const double dy = y1 - y0;
            double d1x = c1x - x0;
            double slope1 = 0.0;
            double slope2 = 0.0;
            if (d1x != 0.0) slope1 = (c1y - y0) / d1x;
            d1x = x1 - c2x;
            if (d1x != 0.0) slope2 = (y1 - c2y) / d1x;
            const double invDx2 = 1.0 / (dx * dx);
            const double slope1Dx = slope1 * dx;
            const double slope2Dx = slope2 * dx;
            curve->interpV2 = (invDx2 * (slope1Dx + slope2Dx - dy - dy)) / dx;
            curve->interpV3 = invDx2 * (dy + dy + dy - slope1Dx - slope1Dx - slope2Dx);
            curve->interpV4 = slope1;
            curve->interpV5 = y0;
        }
        curve->pointIndexUpdated = false;
    }

    if (useCurrentY) return point->y;
    if (useNextY) {
        if (point->x != t &&
            point->nextIndex >= 0 &&
            static_cast<std::size_t>(point->nextIndex) < curve->points.size()) {
            return curve->points[static_cast<std::size_t>(point->nextIndex)].y;
        }
        return point->y;
    }
    if (curve->boolFlag) {
        return interpolateBezierSegment(*curve, t);
    }

    const double dt = static_cast<double>(t) - curve->interpV0;
    const double y =
        curve->interpV5 +
        dt * ((dt * curve->interpV2 + curve->interpV3) * dt + curve->interpV4);
    return static_cast<float>(y);
}

inline Status decodeSkeletalCurve(Uint8ArrayReader& reader, i32 /*version*/, SkeletalCurve* out) noexcept {
    if (!out) return Status::InvalidArgument;
    out->points.clear();
    out->values.clear();
    out->minValue = 0.0f;
    out->maxValue = 0.0f;
    out->pointIndex = 0;
    out->pointIndexUpdated = true;

    u16 countU16 = 0;
    Status s = reader.readUnsignedShort(&countU16);
    if (!ok(s)) return s;

    u8 type = 0;
    s = reader.readUnsignedByte(&type);
    if (!ok(s)) return s;
    out->type = static_cast<i32>(type);

    u8 startInterp = 0;
    s = reader.readUnsignedByte(&startInterp);
    if (!ok(s)) return s;
    out->startInterpType = getCurveInterpTypeForId(static_cast<i32>(startInterp));

    u8 endInterp = 0;
    s = reader.readUnsignedByte(&endInterp);
    if (!ok(s)) return s;
    out->endInterpType = getCurveInterpTypeForId(static_cast<i32>(endInterp));

    u8 boolByte = 0;
    s = reader.readUnsignedByte(&boolByte);
    if (!ok(s)) return s;
    out->boolFlag = boolByte != 0;

    auto rr = out->points.resize(static_cast<std::size_t>(countU16));
    if (!rr.isOk()) return rr.status();
    for (u16 i = 0; i < countU16; i++) {
        i16 x = 0;
        float y = 0.0f;
        float inDx = 0.0f;
        float inDy = 0.0f;
        float outDx = 0.0f;
        float outDy = 0.0f;
        s = reader.readShort(&x);
        if (!ok(s)) return s;
        s = reader.readFloat(&y);
        if (!ok(s)) return s;
        s = reader.readFloat(&inDx);
        if (!ok(s)) return s;
        s = reader.readFloat(&inDy);
        if (!ok(s)) return s;
        s = reader.readFloat(&outDx);
        if (!ok(s)) return s;
        s = reader.readFloat(&outDy);
        if (!ok(s)) return s;
        SkeletalCurvePoint p{};
        p.x = static_cast<i32>(x);
        p.y = y;
        p.inTangentDx = inDx;
        p.inTangentDy = inDy;
        p.outTangentDx = outDx;
        p.outTangentDy = outDy;
        p.nextIndex = (i + 1 < countU16) ? static_cast<i32>(i + 1) : -1;
        out->points[static_cast<std::size_t>(i)] = p;
    }
    return Status::Ok;
}

inline Status loadSkeletalCurve(SkeletalCurve* curve) noexcept {
    if (!curve) return Status::InvalidArgument;
    if (curve->points.empty()) return Status::Ok;

    curve->startTick = curve->points[0].x;
    curve->endTick = curve->points[curve->points.size() - 1].x;
    const i32 duration = skeletalCurveTickDuration(*curve);
    if (duration < 0) {
        return Status::BadFormat;
    }
    auto rr = curve->values.resize(static_cast<std::size_t>(duration + 1));
    if (!rr.isOk()) return rr.status();

    curve->pointIndex = 0;
    curve->pointIndexUpdated = true;
    for (i32 t = curve->startTick; t <= curve->endTick; t++) {
        curve->values[static_cast<std::size_t>(t - curve->startTick)] = interpolateCurve(curve, t);
    }

    // Mirrors TS behavior: points are discarded after baking.
    curve->points.clear();
    curve->points.releaseMemory();

    // Mirrors TS semantics: after points are discarded min/max evaluate to 0.
    curve->minValue = interpolateCurve(curve, curve->startTick - 1);
    curve->maxValue = interpolateCurve(curve, curve->endTick + 1);
    return Status::Ok;
}

inline float getSkeletalCurveValue(const SkeletalCurve& curve, i32 t) noexcept {
    if (t < curve.startTick) return curve.minValue;
    if (t > curve.endTick) return curve.maxValue;
    if (curve.values.empty()) return 0.0f;
    const i32 idx = t - curve.startTick;
    if (idx < 0 || static_cast<std::size_t>(idx) >= curve.values.size()) return 0.0f;
    return curve.values[static_cast<std::size_t>(idx)];
}

} // namespace rs
