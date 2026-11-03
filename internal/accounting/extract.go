package accounting

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

const currencyCodes = `EUR|USD|GBP|CHF|CAD|AUD|JPY|SEK|NOK|DKK|PLN|CNY`

var moneyPattern = regexp.MustCompile(`(?:\d{1,3}(?:[., '\x{00a0}]\d{3})+|\d+)[.,]\d{2}`)
var datePattern = regexp.MustCompile(`\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b`)
var itemPattern = regexp.MustCompile(`^(.+?)\s+(\d{1,5})\s+([\d.,]+)\s+(\d{1,3}(?:[.,]\d{1,2})?)%\s+([\d.,]+)\s*$`)

func parseAmount(value string) (int64, bool) {
	value = strings.NewReplacer(" ", "", "\u00a0", "", "'", "").Replace(strings.TrimSpace(value))
	last := strings.LastIndexAny(value, ".,")
	if last < 1 || len(value)-last-1 != 2 {
		return 0, false
	}
	grouped := value[:last]
	if strings.ContainsAny(grouped, ".,") {
		separator := ","
		if value[last] == ',' {
			separator = "."
		}
		if !regexp.MustCompile(`^\d{1,3}(?:` + regexp.QuoteMeta(separator) + `\d{3})+$`).MatchString(grouped) {
			return 0, false
		}
	}
	whole := strings.NewReplacer(".", "", ",", "").Replace(grouped)
	if !regexp.MustCompile(`^\d+$`).MatchString(whole) {
		return 0, false
	}
	a, err := strconv.ParseInt(whole, 10, 64)
	if err != nil || a > MaxAmount/100 {
		return 0, false
	}
	b, err := strconv.ParseInt(value[last+1:], 10, 64)
	if err != nil || b < 0 || b > 99 {
		return 0, false
	}
	result := a*100 + b
	return result, result <= MaxAmount
}

func field(text, label string) string {
	match := regexp.MustCompile(`(?im)(?:^|\s{2,})(?:` + label + `)(?:[ \t]*[:#-][ \t]*|[ \t]+)([^\r\n]+)`).FindStringSubmatch(text)
	if len(match) == 2 {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func parseRate(value string) (int64, bool) {
	value = strings.ReplaceAll(value, ",", ".")
	if !regexp.MustCompile(`^\d{1,3}(?:\.\d{1,2})?$`).MatchString(value) {
		return 0, false
	}
	if !strings.Contains(value, ".") {
		value += ".00"
	} else if len(value)-strings.Index(value, ".") == 2 {
		value += "0"
	}
	rate, ok := parseAmount(value)
	return rate, ok && rate <= 10000
}

func extractedDate(text string) string {
	value := datePattern.FindString(text)
	for _, layout := range []string{"2006-01-02", "2006-1-2", "2006/1/2", "2006.1.2", "02/01/2006", "2/1/2006", "02-01-2006", "2-1-2006", "02.01.2006", "2.1.2006"} {
		if date, err := time.Parse(layout, value); err == nil {
			result := date.Format("2006-01-02")
			if ValidDate(result) {
				return result
			}
		}
	}
	return ""
}

func labelledAmount(text, pattern string) (int64, bool) {
	var amount int64
	found := false
	label := regexp.MustCompile(`(?i)^\s*(?:` + pattern + `)(?:[ \t]*:[ \t]*|[ \t]+)(?:(?:` + currencyCodes + `|[€$£])[ \t]*)?(` + moneyPattern.String() + `)(?:[^0-9.,]|$)`)
	for _, line := range strings.Split(text, "\n") {
		line = strings.NewReplacer("\u00a0", " ", "\u202f", " ").Replace(line)
		match := label.FindStringSubmatch(line)
		if len(match) == 2 {
			if parsed, ok := parseAmount(match[1]); ok {
				amount, found = parsed, true
			}
		}
	}
	return amount, found
}

func extract(text string) Scan {
	scan := emptyScan()
	scan.Text = strings.TrimSpace(text)
	scan.Draft.Partner = field(text, `supplier|vendor|seller|from|leverancier|fournisseur`)
	if scan.Draft.Partner == "" {
		for _, line := range strings.Split(text, "\n") {
			line = strings.TrimSpace(line)
			if len(line) >= 3 && len(line) <= 200 && !regexp.MustCompile(`(?i)invoice|factuur|facture|receipt|bill\b|^\d|^page`).MatchString(line) {
				scan.Draft.Partner = line
				scan.Warnings = append(scan.Warnings, "Supplier inferred from the document header. Confirm the supplier name.")
				break
			}
		}
	}
	scan.Draft.Reference = field(text, `(?:invoice|factuur|facture|bill)\s*(?:number|no\.?|nr\.?|nummer|num[eé]ro|#)`)
	scan.Draft.Date = extractedDate(field(text, `invoice date|issue date|factuurdatum|date de facture|datum|date`))
	scan.Draft.DueDate = extractedDate(field(text, `due date|payment due|vervaldatum|[eé]ch[eé]ance`))
	if scan.Draft.DueDate == "" && scan.Draft.Date != "" {
		scan.Draft.DueDate = scan.Draft.Date
		scan.Warnings = append(scan.Warnings, "Due date not found; the document date is proposed. Confirm the payment terms.")
	}
	if regexp.MustCompile(`\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b`).MatchString(text) {
		scan.Warnings = append(scan.Warnings, "Numeric dates are interpreted day/month/year. Verify both dates.")
	}
	currency := regexp.MustCompile(`(?i)\b[A-Z]{3}\b`).FindString(field(text, `currency|valuta|devise`))
	if currency == "" {
		currency = regexp.MustCompile(`(?i)\b(?:` + currencyCodes + `)\b`).FindString(text)
	}
	scan.Currency = strings.ToUpper(currency)
	if scan.Currency == "" && strings.Contains(text, "€") {
		scan.Currency = "EUR"
	}
	if scan.Currency == "" && strings.Contains(text, "$") {
		scan.Currency = "USD"
	}
	if scan.Currency == "" && strings.Contains(text, "£") {
		scan.Currency = "GBP"
	}
	if scan.Currency == "" {
		scan.Warnings = append(scan.Warnings, "Currency not detected. Confirm that the bill is in EUR.")
	}
	if scan.Currency != "" && scan.Currency != "EUR" {
		scan.Warnings = append(scan.Warnings, "This bill is not in EUR. Multi-currency bills cannot be converted in this release.")
	}
	subtotal, subtotalKnown := labelledAmount(text, `subtotal|sub[\s-]total|subtotaal|net(?: amount)?|excl(?:usive)?\.?\s*(?:vat|btw)|totaal\s+excl(?:\.|usief)?(?:\s+btw)?|(?:montant|total)\s+ht`)
	tax, taxKnown := labelledAmount(text, `(?:(?:total|totaal)\s+)?(?:vat|btw|tva|tax(?:es)?)(?:\s+(?:rate\s*:?\s*)?\d{1,3}(?:[.,]\d{1,2})?\s*%)?`)
	total, totalKnown := labelledAmount(text, `(?:grand total|invoice total|total|totaal)(?:\s+(?:incl(?:\.|usive|usief)?(?:\s+(?:vat|btw|tax(?:es)?))?|amount))?|(?:montant|total)\s+ttc`)
	balance, balanceKnown := labelledAmount(text, `(?:amount|balance|total)\s+due|total\s+to\s+pay|te\s+betalen`)
	if !totalKnown {
		total, totalKnown = balance, balanceKnown
	} else if balanceKnown && balance != total {
		scan.Warnings = append(scan.Warnings, "The balance due differs from the invoice total. Verify prior payments separately; no payment is imported automatically.")
	}
	if !subtotalKnown && totalKnown && taxKnown && total > tax {
		subtotal, subtotalKnown = total-tax, true
		scan.Warnings = append(scan.Warnings, "Subtotal inferred from total and VAT. Verify the tax breakdown.")
	}
	scan.Subtotal, scan.Tax, scan.Total, scan.TaxKnown = subtotal, tax, total, taxKnown
	items := []Line{}
	var itemBase, itemTax int64
	for _, row := range strings.Split(text, "\n") {
		match := itemPattern.FindStringSubmatch(strings.TrimSpace(row))
		if len(match) != 6 || len(items) >= 100 {
			continue
		}
		quantity, qErr := strconv.ParseInt(match[2], 10, 64)
		price, priceOK := parseAmount(match[3])
		bps, rateOK := parseRate(match[4])
		printed, totalOK := parseAmount(match[5])
		if qErr != nil || quantity < 1 || quantity > 10000 || !priceOK || price > 1_000_000_000 || !rateOK || bps > 10000 || !totalOK {
			continue
		}
		base := quantity * price
		lineTax := (base*bps + 5000) / 10000
		if printed != base+lineTax && printed != base {
			continue
		}
		items = append(items, Line{Description: strings.TrimSpace(match[1]), Quantity: quantity, UnitCents: price, TaxBPS: bps, AccountCode: "5000"})
		itemBase += base
		itemTax += lineTax
	}
	if len(items) > 0 && totalKnown && itemBase+itemTax == total && (!taxKnown || itemTax == tax) && (!subtotalKnown || itemBase == subtotal) {
		scan.Draft.Lines = items
		scan.Subtotal, scan.Tax, scan.TaxKnown = itemBase, itemTax, true
	} else {
		reliableRate := int64(-1)
		if subtotalKnown && taxKnown && subtotal+tax == total && totalKnown {
			matches := []int64{}
			explicit := regexp.MustCompile(`(?i)(?:vat|btw|tva|tax)\s*(?:rate)?\s*[: ]?\s*(\d{1,3}(?:[.,]\d{1,2})?)%`).FindStringSubmatch(text)
			if len(explicit) == 2 {
				if bps, ok := parseRate(explicit[1]); ok && (subtotal*bps+5000)/10000 == tax {
					matches = append(matches, bps)
				}
			} else {
				for _, rate := range []int64{0, 600, 900, 1200, 1900, 2000, 2100} {
					if (subtotal*rate+5000)/10000 == tax {
						matches = append(matches, rate)
					}
				}
			}
			if len(matches) == 1 {
				reliableRate = matches[0]
			}
		}
		if reliableRate >= 0 && subtotal <= 1_000_000_000 {
			scan.Draft.Lines[0].UnitCents, scan.Draft.Lines[0].TaxBPS = subtotal, reliableRate
			scan.Warnings = append(scan.Warnings, "A summary line was proposed. Review or replace it with the original bill's line items.")
		} else {
			scan.Warnings = append(scan.Warnings, "Line items or VAT could not be reliably reconciled. Enter the line amounts and VAT from the original.")
		}
	}
	if subtotalKnown && taxKnown && totalKnown && subtotal+tax != total {
		scan.Warnings = append(scan.Warnings, "The scanned subtotal plus VAT does not equal the scanned total.")
	}
	for _, missing := range []struct{ value, name string }{{scan.Draft.Partner, "supplier"}, {scan.Draft.Reference, "invoice number"}, {scan.Draft.Date, "document date"}, {scan.Draft.DueDate, "due date"}} {
		if missing.value == "" {
			scan.Warnings = append(scan.Warnings, "Could not detect "+missing.name+". Enter it during review.")
		}
	}
	if !totalKnown {
		scan.Warnings = append(scan.Warnings, "Could not detect the invoice total. Verify it against the original.")
	}
	scan.Warnings = append(scan.Warnings, "Extraction is a best-effort local label parser, not a guaranteed accounting interpretation. Review all fields.")
	return scan
}
