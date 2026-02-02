import { vec2 } from "gl-matrix";

import { FloatUtil } from "../../../util/FloatUtil";
import { Curve } from "./Curve";
import { CurveInterpType } from "./CurveInterpType";

const ULP = 1.1920929e-7;
const ULP2 = 2 * ULP;

export function interpolateCurve(curve: Curve, t: number): number {
    if (!curve || !curve.points || curve.points.length === 0) {
        return 0;
    }
    if (t < curve.startTick) {
        if (curve.startInterpType === CurveInterpType.TYPE_0) {
            return curve.points[0].y;
        } else {
            return extrapolateCurve(curve, t, true);
        }
    } else if (t > curve.endTick) {
        if (curve.endInterpType === CurveInterpType.TYPE_0) {
            return curve.points[curve.points.length - 1].y;
        } else {
            return extrapolateCurve(curve, t, false);
        }
    } else if (curve.noInterp) {
        return curve.points[0].y;
    }
    const point = curve.getCurvePoint(t);
    if (!point) {
        return 0;
    }
    let useCurrentY = false;
    let useNextY = false;

    if (point.field4 === 0 && point.field5 === 0) {
        useCurrentY = true;
    } else if (point.field4 === FloatUtil.MAX_VALUE && point.field5 === FloatUtil.MAX_VALUE) {
        useNextY = true;
    } else if (!point.next) {
        useCurrentY = true;
    } else if (curve.pointIndexUpdated) {
        const x0 = point.x;
        const y0 = point.y;
        const c1x = point.field4 * 0.33333334 + x0;
        const c1y = point.field5 * 0.33333334 + y0;
        const x1 = point.next.x;
        const y1 = point.next.y;
        const c2x = x1 - point.next.field2 * 0.33333334;
        const c2y = y1 - point.next.field3 * 0.33333334;
        if (curve.bool) {
            let adjC1y = c1y;
            let adjC2y = c2y;
            const dx = x1 - x0;
            if (dx !== 0.0) {
                const u1 = c1x - x0;
                const u2 = c2x - x0;
                const controlX01 = vec2.fromValues(u1 / dx, u2 / dx);
                curve.interpBool = controlX01[0] === 0.33333334 && controlX01[1] === 0.6666667;
                const origU1 = controlX01[0];
                const origU2 = controlX01[1];
                if (controlX01[0] < 0.0) {
                    controlX01[0] = 0.0;
                }

                if (controlX01[1] > 1.0) {
                    controlX01[1] = 1.0;
                }

                if (controlX01[0] > 1.0 || controlX01[1] < -1.0) {
                    clampBezierControlX01InPlace(controlX01);
                }

                if (controlX01[0] !== origU1) {
                    if (0.0 !== origU1) {
                        adjC1y = ((c1y - y0) * controlX01[0]) / origU1 + y0;
                    }
                }

                if (origU2 !== controlX01[1]) {
                    if (1.0 !== origU2) {
                        adjC2y = y1 - ((1.0 - controlX01[1]) * (y1 - c2y)) / (1.0 - origU2);
                    }
                }

                curve.interpV0 = x0;
                curve.interpV1 = x1;
                const bezierU1 = controlX01[0];
                const bezierU2 = controlX01[1];
                let a = bezierU1 - 0.0;
                let b = bezierU2 - bezierU1;
                let c = 1.0 - bezierU2;
                let d = b - a;
                curve.interpV5 = c - b - d;
                curve.interpV4 = d + d + d;
                curve.interpV3 = a + a + a;
                curve.interpV2 = 0.0;
                a = adjC1y - y0;
                b = adjC2y - adjC1y;
                c = y1 - adjC2y;
                d = b - a;
                curve.interpV9 = c - b - d;
                curve.interpV8 = d + d + d;
                curve.interpV7 = a + a + a;
                curve.interpV6 = y0;
            }
        } else {
            curve.interpV0 = x0;
            const dx = x1 - x0;
            const dy = y1 - y0;
            let d1x = c1x - x0;
            let slope1 = 0.0;
            let slope2 = 0.0;
            if (d1x !== 0.0) {
                slope1 = (c1y - y0) / d1x;
            }

            d1x = x1 - c2x;
            if (d1x !== 0.0) {
                slope2 = (y1 - c2y) / d1x;
            }

            const invDx2 = 1.0 / (dx * dx);
            const slope1Dx = slope1 * dx;
            const slope2Dx = slope2 * dx;
            curve.interpV2 = (invDx2 * (slope1Dx + slope2Dx - dy - dy)) / dx;
            curve.interpV3 = invDx2 * (dy + dy + dy - slope1Dx - slope1Dx - slope2Dx);
            curve.interpV4 = slope1;
            curve.interpV5 = y0;
        }

        curve.pointIndexUpdated = false;
    }

    if (useCurrentY) {
        return point.y;
    } else if (useNextY) {
        if (point.x !== t && point.next) {
            return point.next.y;
        } else {
            return point.y;
        }
    } else if (curve.bool) {
        return interpolateBezierSegment(curve, t);
    } else {
        const dt = t - curve.interpV0;
        const y =
            curve.interpV5 + dt * ((dt * curve.interpV2 + curve.interpV3) * dt + curve.interpV4);

        return y;
    }
}

export function extrapolateCurve(curve: Curve, t: number, isStart: boolean): number {
    if (!curve || !curve.points || curve.points.length === 0) {
        return 0;
    }
    const startX = curve.points[0].x;
    const endX = curve.points[curve.points.length - 1].x;
    const rangeX = endX - startX;
    if (rangeX === 0.0) {
        return curve.points[0].y;
    }

    let normalizedPos: number;
    if (t > endX) {
        normalizedPos = (t - endX) / rangeX;
    } else {
        normalizedPos = (t - startX) / rangeX;
    }

    let cycleCount = normalizedPos | 0;
    let cycleFrac = Math.abs(normalizedPos - cycleCount);
    let mappedT = cycleFrac * rangeX;
    cycleCount = Math.abs(1.0 + cycleCount);
    const halfCycles = cycleCount / 2.0;
    const halfCyclesInt = halfCycles | 0;
    const pingPongPhase = halfCycles - halfCyclesInt;
    if (isStart) {
        if (curve.startInterpType === CurveInterpType.TYPE_4) {
            if (pingPongPhase !== 0.0) {
                mappedT += startX;
            } else {
                mappedT = endX - mappedT;
            }
        } else if (
            curve.startInterpType === CurveInterpType.TYPE_2 ||
            curve.startInterpType === CurveInterpType.TYPE_3
        ) {
            mappedT = endX - mappedT;
        } else if (curve.startInterpType === CurveInterpType.TYPE_1) {
            mappedT = startX - t;
            const tangentDx = curve.points[0].field2;
            const tangentDy = curve.points[0].field3;
            let output = curve.points[0].y;
            if (tangentDx !== 0.0) {
                output -= (mappedT * tangentDy) / tangentDx;
            }
            return output;
        }
    } else {
        if (curve.endInterpType === CurveInterpType.TYPE_4) {
            if (pingPongPhase !== 0.0) {
                mappedT = endX - mappedT;
            } else {
                mappedT += startX;
            }
        } else if (
            curve.endInterpType === CurveInterpType.TYPE_2 ||
            curve.endInterpType === CurveInterpType.TYPE_3
        ) {
            mappedT += startX;
        } else if (curve.endInterpType === CurveInterpType.TYPE_1) {
            mappedT = t - endX;
            const tangentDx = curve.points[curve.getPointCount() - 1].field4;
            const tangentDy = curve.points[curve.getPointCount() - 1].field5;
            let output = curve.points[curve.getPointCount() - 1].y;
            if (tangentDx !== 0.0) {
                output += (tangentDy * mappedT) / tangentDx;
            }
            return output;
        }
    }
    let output = interpolateCurve(curve, mappedT);
    if (isStart && curve.startInterpType === CurveInterpType.TYPE_3) {
        const cycleDeltaY = curve.points[curve.points.length - 1].y - curve.points[0].y;
        output = output - cycleDeltaY * cycleCount;
    } else if (!isStart && curve.endInterpType === CurveInterpType.TYPE_3) {
        const cycleDeltaY = curve.points[curve.points.length - 1].y - curve.points[0].y;
        output = output + cycleDeltaY * cycleCount;
    }
    return output;
}

function clampBezierControlX01InPlace(v: vec2): void {
    v[1] = 1.0 - v[1];
    if (v[0] < 0.0) {
        v[0] = 0.0;
    }

    if (v[1] < 0.0) {
        v[1] = 0.0;
    }

    if (v[0] > 1.0 || v[1] > 1.0) {
        const constraint = 1.0 + v[0] * (v[0] - 2.0 + v[1]) + (v[1] - 2.0) * v[1];
        if (constraint + ULP > 0.0) {
            if (ULP + v[0] < 1.3333334) {
                const a = v[0] - 2.0;
                const b = v[0] - 1.0;
                const sqrtTerm = Math.sqrt(a * a - 4.0 * b * b);
                const upperY = 0.5 * (sqrtTerm + -a);
                if (v[1] + ULP > upperY) {
                    v[1] = upperY - ULP;
                } else {
                    const lowerY = (-a - sqrtTerm) * 0.5;
                    if (v[1] < lowerY + ULP) {
                        v[1] = lowerY + ULP;
                    }
                }
            } else {
                v[0] = 1.3333334 - ULP;
                v[1] = 0.33333334 - ULP;
            }
        }
    }

    v[1] = 1.0 - v[1];
}

const rootSolveCoeffs = new Float32Array(4);
const rootSolveRoots = new Float32Array(5);

function interpolateBezierSegment(curve: Curve, t: number): number {
    if (!curve) {
        return 0;
    }
    let v0: number;
    if (curve.interpV0 === t) {
        v0 = 0.0;
    } else if (t === curve.interpV1) {
        v0 = 1.0;
    } else {
        v0 = (t - curve.interpV0) / (curve.interpV1 - curve.interpV0);
    }

    let v1: number;
    if (curve.interpBool) {
        v1 = v0;
    } else {
        rootSolveCoeffs[3] = curve.interpV5;
        rootSolveCoeffs[2] = curve.interpV4;
        rootSolveCoeffs[1] = curve.interpV3;
        rootSolveCoeffs[0] = curve.interpV2 - v0;
        rootSolveRoots[0] = 0.0;
        rootSolveRoots[1] = 0.0;
        rootSolveRoots[2] = 0.0;
        rootSolveRoots[3] = 0.0;
        rootSolveRoots[4] = 0.0;
        const rootCount = findPolynomialRootsInInterval(
            rootSolveCoeffs,
            3,
            0.0,
            true,
            1.0,
            true,
            rootSolveRoots,
        );
        if (rootCount === 1) {
            v1 = rootSolveRoots[0];
        } else {
            v1 = 0.0;
        }
    }

    return v1 * (curve.interpV7 + v1 * (v1 * curve.interpV9 + curve.interpV8)) + curve.interpV6;
}

function evaluatePolynomial(values: Float32Array, lastIndex: number, x: number): number {
    let output = values[lastIndex];

    for (let i = lastIndex - 1; i >= 0; i--) {
        output = output * x + values[i];
    }

    return output;
}

function findPolynomialRootsInInterval(
    coeffs: Float32Array,
    degree: number,
    minX: number,
    minInclusive: boolean,
    maxX: number,
    maxInclusive: boolean,
    rootsOut: Float32Array,
): number {
    let coeffAbsSum = 0.0;

    for (let i = 0; i < degree + 1; i++) {
        coeffAbsSum += Math.abs(coeffs[i]);
    }

    const eps = (Math.abs(minX) + Math.abs(maxX)) * (degree + 1) * ULP;
    if (coeffAbsSum <= eps) {
        return -1;
    }
    const normalizedCoeffs = new Float32Array(degree + 1);

    for (let i = 0; i < degree + 1; i++) {
        normalizedCoeffs[i] = (1.0 / coeffAbsSum) * coeffs[i];
    }

    while (Math.abs(normalizedCoeffs[degree]) < eps) {
        degree--;
    }

    let rootCount = 0;
    if (degree === 0) {
        return rootCount;
    } else if (degree === 1) {
        rootsOut[0] = -normalizedCoeffs[0] / normalizedCoeffs[1];
        const minOk = minInclusive ? minX < rootsOut[0] + eps : minX < rootsOut[0] - eps;
        const maxOk = maxInclusive ? maxX > rootsOut[0] - eps : maxX > rootsOut[0] + eps;
        rootCount = minOk && maxOk ? 1 : 0;
        if (rootCount > 0) {
            if (minInclusive && rootsOut[0] < minX) {
                rootsOut[0] = minX;
            } else if (maxInclusive && rootsOut[0] > maxX) {
                rootsOut[0] = maxX;
            }
        }

        return rootCount;
    } else {
        const polyCoeffs = normalizedCoeffs;
        const polyDegree = degree;

        const derivativeCoeffs = new Float32Array(degree + 1);

        for (let i = 1; i <= degree; i++) {
            derivativeCoeffs[i - 1] = i * normalizedCoeffs[i];
        }

        const derivativeRoots = new Float32Array(degree + 1);
        const derivativeRootCount = findPolynomialRootsInInterval(
            derivativeCoeffs,
            degree - 1,
            minX,
            false,
            maxX,
            false,
            derivativeRoots,
        );
        if (derivativeRootCount === -1) {
            return 0;
        }

        let prevWasRoot = false;
        let fRight = 0.0;
        let fLeft = 0.0;
        let rightX = 0.0;

        for (let s = 0; s <= derivativeRootCount; s++) {
            if (rootCount > degree) {
                return rootCount;
            }

            let leftX: number;
            if (s === 0) {
                leftX = minX;
                fLeft = evaluatePolynomial(normalizedCoeffs, degree, minX);
                if (Math.abs(fLeft) <= eps && minInclusive) {
                    rootsOut[rootCount++] = minX;
                }
            } else {
                leftX = rightX;
                fLeft = fRight;
            }

            if (derivativeRootCount === s) {
                rightX = maxX;
                prevWasRoot = false;
            } else {
                rightX = derivativeRoots[s];
            }

            fRight = evaluatePolynomial(normalizedCoeffs, degree, rightX);
            if (prevWasRoot) {
                prevWasRoot = false;
            } else if (Math.abs(fRight) < eps) {
                if (derivativeRootCount !== s || maxInclusive) {
                    rootsOut[rootCount++] = rightX;
                    prevWasRoot = true;
                }
            } else if ((fLeft < 0.0 && fRight > 0.0) || (fLeft > 0.0 && fRight < 0.0)) {
                const rootIndex = rootCount++;
                let a = leftX;
                let b = rightX;
                let fa = evaluatePolynomial(polyCoeffs, polyDegree, leftX);
                let root: number;
                if (Math.abs(fa) < ULP) {
                    root = leftX;
                } else {
                    let fb = evaluatePolynomial(polyCoeffs, polyDegree, rightX);
                    if (Math.abs(fb) < ULP) {
                        root = rightX;
                    } else {
                        let c = 0.0;
                        let d = 0.0;
                        let e = 0.0;
                        let fc = 0.0;
                        let needsInit = true;
                        let continueLoop = false;

                        do {
                            continueLoop = false;
                            if (needsInit) {
                                c = a;
                                fc = fa;
                                d = b - a;
                                e = d;
                                needsInit = false;
                            }

                            if (Math.abs(fc) < Math.abs(fb)) {
                                a = b;
                                b = c;
                                c = a;
                                fa = fb;
                                fb = fc;
                                fc = fa;
                            }

                            const tol = ULP2 * Math.abs(b) + 0.0;
                            const m = 0.5 * (c - b);
                            const shouldContinue = Math.abs(m) > tol && fb !== 0.0;
                            if (shouldContinue) {
                                if (Math.abs(e) < tol || Math.abs(fa) <= Math.abs(fb)) {
                                    d = m;
                                    e = m;
                                } else {
                                    const s = fb / fa;
                                    let p: number;
                                    let q: number;
                                    if (a === c) {
                                        p = m * 2.0 * s;
                                        q = 1.0 - s;
                                    } else {
                                        q = fa / fc;
                                        const r = fb / fc;
                                        p = s * (m * 2.0 * q * (q - r) - (r - 1.0) * (b - a));
                                        q = (r - 1.0) * (q - 1.0) * (s - 1.0);
                                    }

                                    if (p > 0.0) {
                                        q = -q;
                                    } else {
                                        p = -p;
                                    }

                                    const prevE = e;
                                    e = d;
                                    if (
                                        2.0 * p < 3.0 * m * q - Math.abs(q * tol) &&
                                        p < Math.abs(q * prevE * 0.5)
                                    ) {
                                        d = p / q;
                                    } else {
                                        d = m;
                                        e = m;
                                    }
                                }

                                a = b;
                                fa = fb;
                                if (Math.abs(d) > tol) {
                                    b += d;
                                } else if (m > 0.0) {
                                    b += tol;
                                } else {
                                    b -= tol;
                                }

                                fb = evaluatePolynomial(polyCoeffs, polyDegree, b);
                                if (fb * (fc / Math.abs(fc)) > 0.0) {
                                    needsInit = true;
                                    continueLoop = true;
                                }
                                continueLoop = true;
                            }
                        } while (continueLoop);

                        root = b;
                    }
                }

                rootsOut[rootIndex] = root;
                if (rootCount > 1 && rootsOut[rootCount - 2] >= rootsOut[rootCount - 1] - eps) {
                    rootsOut[rootCount - 2] =
                        0.5 * (rootsOut[rootCount - 2] + rootsOut[rootCount - 1]);
                    rootCount--;
                }
            }
        }

        return rootCount;
    }
}
