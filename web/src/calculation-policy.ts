import type { CalculationTaxGroup, PolicyLineData } from './types'

const scale = 10_000n
const extensionDivisor = 1_000_000n
const maximumQuantity = 100_000_000n
const maximumPrice = 100_000_000_000n
const maximumAmount = 1_000_000_000_000n
const maximumExtension = 100_000_000_000n
const maximumInt64 = 9_223_372_036_854_775_807n

interface Rational {
  numerator: bigint
  denominator: bigint
}

export interface PolicyPreviewLine {
  lineId?: string
  netMinor: string
  taxMinor?: string
  grossMinor?: string
  netRoundingResidue: { numerator: string; denominator: string }
}

export interface PolicyCalculationPreview {
  netMinor: string
  taxMinor: string
  grossMinor: string
  lines: PolicyPreviewLine[]
  taxGroups: CalculationTaxGroup[]
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n)
    throw new Error('calculation intermediate exceeds the supported precision')
  const sign = denominator < 0n ? -1n : 1n
  const divisor = gcd(numerator, denominator)
  const result = {
    numerator: (numerator / divisor) * sign,
    denominator: (denominator / divisor) * sign,
  }
  if (
    result.numerator.toString().replace('-', '').length > 128 ||
    result.denominator.toString().length > 128
  )
    throw new Error('calculation intermediate exceeds the supported precision')
  return result
}

function subtract(left: Rational, right: Rational): Rational {
  return rational(
    left.numerator * right.denominator - right.numerator * left.denominator,
    left.denominator * right.denominator,
  )
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator)
}

function roundHalfUp(value: Rational): bigint {
  if (value.numerator < 0n) throw new Error('rounding requires a bounded nonnegative exact value')
  const rounded = (2n * value.numerator + value.denominator) / (2n * value.denominator)
  if (rounded > maximumAmount) throw new Error('rounded amount exceeds int64')
  return rounded
}

function scaled(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new Error('scaled integer is not canonical or exceeds int64')
  const parsed = BigInt(value)
  if (parsed > maximumInt64) throw new Error('scaled integer is not canonical or exceeds int64')
  return parsed
}

function compareUTF8(left: string, right: string): number {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  for (let index = 0; index < Math.min(a.length, b.length); index++)
    if (a[index] !== b[index]) return a[index] - b[index]
  return a.length - b.length
}

interface WorkingLine {
  input: PolicyLineData
  netMinor: bigint
  residue: Rational
  taxMinor?: bigint
}

export function calculatePolicyPreview(lines: PolicyLineData[]): PolicyCalculationPreview {
  if (lines.length < 1 || lines.length > 100)
    throw new Error('calculation document needs 1 to 100 lines')

  const seen = new Set<string>()
  const work: WorkingLine[] = []
  let netMinor = 0n
  for (const input of lines) {
    const quantity = scaled(input.quantityUnits)
    const unitPrice = scaled(input.unitPriceUnits)
    const fixedDiscount = scaled(input.fixedDiscountUnits)
    const taxRate = scaled(input.taxRateBps)
    if (
      (input.lineId !== undefined && (!input.lineId || seen.has(input.lineId))) ||
      quantity <= 0n ||
      quantity > maximumQuantity ||
      unitPrice > maximumPrice ||
      taxRate > scale ||
      input.percentageDiscountBps.length > 4
    )
      throw new Error('quantity, price, discount, or tax rate is outside policy bounds')
    if (input.lineId) seen.add(input.lineId)

    const extension = rational(quantity * unitPrice, extensionDivisor)
    if (extension.numerator > maximumExtension * extension.denominator)
      throw new Error('pre-discount line extension exceeds the supported bound')
    let exactNet = subtract(extension, rational(fixedDiscount, 100n))
    if (exactNet.numerator < 0n)
      throw new Error('fixed line discount exceeds the exact line extension')
    for (const rawRate of input.percentageDiscountBps) {
      const rate = scaled(rawRate)
      if (rate > scale) throw new Error('percentage discount is outside policy bounds')
      exactNet = multiply(exactNet, rational(scale - rate, scale))
    }

    const lineNet = roundHalfUp(exactNet)
    if (lineNet > maximumAmount) throw new Error('settled line net exceeds the supported amount')
    netMinor += lineNet
    if (netMinor > maximumAmount) throw new Error('document net exceeds the supported amount')
    work.push({
      input,
      netMinor: lineNet,
      residue: subtract(rational(lineNet), exactNet),
    })
  }

  const groups = new Map<string, WorkingLine[]>()
  for (const line of work) {
    const rate = line.input.taxRateBps
    groups.set(rate, [...(groups.get(rate) ?? []), line])
  }
  const taxGroups: CalculationTaxGroup[] = []
  let taxMinor = 0n
  for (const [rawRate, group] of [...groups.entries()].sort(([left], [right]) =>
    BigInt(left) < BigInt(right) ? -1 : 1,
  )) {
    const rate = scaled(rawRate)
    const groupNet = group.reduce((sum, line) => sum + line.netMinor, 0n)
    const groupTax = roundHalfUp(rational(groupNet * rate, scale))
    let independentTax = 0n
    for (const line of group) independentTax += roundHalfUp(rational(line.netMinor * rate, scale))
    const adjustment = groupTax - independentTax
    if (groupTax > maximumAmount) throw new Error('tax group exceeds the supported amount')

    if (group.every((line) => line.input.lineId)) {
      let floorSum = 0n
      const shares = group.map((line) => {
        const numerator = line.netMinor * rate
        const floor = numerator / scale
        floorSum += floor
        return { line, floor, remainder: numerator % scale }
      })
      const remaining = groupTax - floorSum
      if (remaining < 0n || remaining > BigInt(shares.length))
        throw new Error('tax allocation remainder is outside the supported range')
      shares.sort(
        (left, right) =>
          (left.remainder > right.remainder ? -1 : left.remainder < right.remainder ? 1 : 0) ||
          compareUTF8(left.line.input.lineId!, right.line.input.lineId!),
      )
      for (let index = 0; index < shares.length; index++)
        shares[index].line.taxMinor = shares[index].floor + (BigInt(index) < remaining ? 1n : 0n)
    }

    taxMinor += groupTax
    if (taxMinor > maximumAmount) throw new Error('document tax exceeds the supported amount')
    taxGroups.push({
      taxRateBps: rawRate,
      netMinor: groupNet.toString(),
      taxMinor: groupTax.toString(),
      independentLineTax: independentTax.toString(),
      roundingAdjustment: adjustment.toString(),
    })
  }

  const grossMinor = netMinor + taxMinor
  if (grossMinor <= 0n || grossMinor > maximumAmount)
    throw new Error('document gross is zero or exceeds the supported amount')

  return {
    netMinor: netMinor.toString(),
    taxMinor: taxMinor.toString(),
    grossMinor: grossMinor.toString(),
    lines: work.map(({ input, netMinor: lineNet, residue, taxMinor: lineTax }) => ({
      ...(input.lineId ? { lineId: input.lineId } : {}),
      netMinor: lineNet.toString(),
      ...(lineTax === undefined
        ? {}
        : { taxMinor: lineTax.toString(), grossMinor: (lineNet + lineTax).toString() }),
      netRoundingResidue: {
        numerator: residue.numerator.toString(),
        denominator: residue.denominator.toString(),
      },
    })),
    taxGroups,
  }
}
