package accounting

import (
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

var (
	ErrInvalid   = errors.New("invalid accounting input")
	ErrNotFound  = errors.New("document not found")
	ErrConflict  = errors.New("document changed; refresh before trying again")
	ErrUncertain = errors.New("write outcome uncertain; reconcile the document and its financial history before retrying")
)

const MaxAmount int64 = 1_000_000_000_000

type Account struct {
	Code string `json:"code"`
	Name string `json:"name"`
	Type string `json:"type"`
}

var Accounts = []Account{
	{"1000", "Bank", "asset"},
	{"1100", "Accounts receivable", "asset"},
	{"1200", "Recoverable VAT", "asset"},
	{"2000", "Accounts payable", "liability"},
	{"2100", "VAT payable", "liability"},
	{"3000", "Retained earnings", "equity"},
	{"4000", "Sales revenue", "income"},
	{"5000", "Operating expenses", "expense"},
}

type Line struct {
	Description string `json:"description" bson:"description"`
	Quantity    int64  `json:"quantity" bson:"quantity"`
	UnitCents   int64  `json:"unitCents" bson:"unitCents"`
	TaxBPS      int64  `json:"taxBps" bson:"taxBps"`
	AccountCode string `json:"accountCode" bson:"accountCode"`
}

type Entry struct {
	AccountCode string `json:"accountCode" bson:"accountCode"`
	Debit       int64  `json:"debit" bson:"debit"`
	Credit      int64  `json:"credit" bson:"credit"`
}

type Payment struct {
	ID        string  `json:"id" bson:"id"`
	Date      string  `json:"date" bson:"date"`
	Amount    int64   `json:"amount" bson:"amount"`
	Reference string  `json:"reference" bson:"reference"`
	Entries   []Entry `json:"entries" bson:"entries"`
}

type Document struct {
	PartnerSnapshot    *PartnerSnapshot    `json:"partnerSnapshot,omitempty" bson:"partnerSnapshot,omitempty"`
	OwnCompanySnapshot *CompanySnapshot    `json:"ownCompanySnapshot,omitempty" bson:"ownCompanySnapshot,omitempty"`
	ID                 primitive.ObjectID  `json:"id" bson:"_id"`
	OrganisationID     primitive.ObjectID  `json:"organisationId" bson:"organisationId"`
	ProjectID          primitive.ObjectID  `json:"projectId" bson:"projectId"`
	OwnerID            primitive.ObjectID  `json:"-" bson:"ownerId,omitempty"`
	SourceID           *primitive.ObjectID `json:"sourceId,omitempty" bson:"sourceId,omitempty"`
	Version            int64               `json:"version" bson:"version"`
	Number             string              `json:"number" bson:"number"`
	Kind               string              `json:"kind" bson:"kind"`
	Partner            string              `json:"partner" bson:"partner"`
	Email              string              `json:"email" bson:"email"`
	Reference          string              `json:"reference" bson:"reference"`
	Date               string              `json:"date" bson:"date"`
	DueDate            string              `json:"dueDate" bson:"dueDate"`
	Currency           string              `json:"currency" bson:"currency"`
	Status             string              `json:"status" bson:"status"`
	Lines              []Line              `json:"lines" bson:"lines"`
	Subtotal           int64               `json:"subtotal" bson:"subtotal"`
	Tax                int64               `json:"tax" bson:"tax"`
	Total              int64               `json:"total" bson:"total"`
	Paid               int64               `json:"paid" bson:"paid"`
	Entries            []Entry             `json:"entries" bson:"entries"`
	Payments           []Payment           `json:"payments" bson:"payments"`
	CreatedAt          time.Time           `json:"createdAt" bson:"createdAt"`
	UpdatedAt          time.Time           `json:"updatedAt" bson:"updatedAt"`

	FinancialEvents []FinancialEvent `json:"-" bson:"financialEvents,omitempty"`
	pendingEvent    *FinancialEvent
}

type Draft struct {
	Kind      string `json:"kind" bson:"kind"`
	Partner   string `json:"partner" bson:"partner"`
	Email     string `json:"email" bson:"email"`
	Reference string `json:"reference" bson:"reference"`
	Date      string `json:"date" bson:"date"`
	DueDate   string `json:"dueDate" bson:"dueDate"`
	Lines     []Line `json:"lines" bson:"lines"`
}

func invalid(message string) error { return fmt.Errorf("%w: %s", ErrInvalid, message) }

func ValidDate(value string) bool {
	date, err := time.Parse("2006-01-02", value)
	return err == nil && date.Year() >= 2000 && date.Year() <= 9999
}

func NewDocument(input Draft, company primitive.ObjectID) (Document, error) {
	id := primitive.NewObjectID()
	now := time.Now().UTC()
	doc := Document{
		ID: id, OrganisationID: company, ProjectID: company, Version: 1,
		Currency: "EUR", Status: "draft", CreatedAt: now, UpdatedAt: now,
		Entries: []Entry{}, Payments: []Payment{},
	}
	if err := doc.SetDraft(input); err != nil {
		return Document{}, err
	}
	prefix := "INV"
	if doc.Kind == "bill" {
		prefix = "BILL"
	}
	// ObjectID-based references are unique, not jurisdiction-specific legal sequences.
	doc.Number = prefix + "-" + strings.ToUpper(id.Hex())
	return doc, nil
}

func (d *Document) NormalizeOwnership() {
	if d.OrganisationID.IsZero() {
		d.OrganisationID = d.OwnerID
	}
	if d.ProjectID.IsZero() {
		d.ProjectID = d.OwnerID
	}
}

func (d *Document) SetDraft(input Draft) error {
	if d.Status != "draft" {
		return invalid("posted documents are immutable")
	}
	if input.Kind != "invoice" && input.Kind != "bill" {
		return invalid("kind must be invoice or bill")
	}
	if d.Kind != "" && input.Kind != d.Kind {
		return invalid("document kind cannot change")
	}
	input.Partner = strings.TrimSpace(input.Partner)
	input.Email = strings.TrimSpace(input.Email)
	if input.Partner == "" || utf8.RuneCountInString(input.Partner) > 200 || len(input.Email) > 254 || utf8.RuneCountInString(input.Reference) > 300 {
		return invalid("provide a partner name; partner, email or reference is too long")
	}
	if input.Email != "" {
		address, err := mail.ParseAddress(input.Email)
		if err != nil || address.Address != input.Email {
			return invalid("provide a valid email address or leave it empty")
		}
	}
	if !ValidDate(input.Date) || !ValidDate(input.DueDate) || input.DueDate < input.Date {
		return invalid("provide valid dates with due date on or after document date")
	}
	if len(input.Lines) == 0 || len(input.Lines) > 100 {
		return invalid("a document needs 1 to 100 lines")
	}
	var subtotal, tax int64
	lines := append([]Line(nil), input.Lines...)
	for i := range lines {
		line := &lines[i]
		line.Description = strings.TrimSpace(line.Description)
		if line.Description == "" || utf8.RuneCountInString(line.Description) > 500 {
			return invalid("each line needs a description of at most 500 characters")
		}
		if line.Quantity < 1 || line.Quantity > 10000 || line.UnitCents < 0 || line.UnitCents > 1_000_000_000 || line.TaxBPS < 0 || line.TaxBPS > 10000 {
			return invalid("line quantity, unit price or tax is out of range")
		}
		expected := "4000"
		if input.Kind == "bill" {
			expected = "5000"
		}
		if line.AccountCode != expected {
			return invalid("invoice lines use Sales revenue; bill lines use Operating expenses")
		}
		base := line.Quantity * line.UnitCents
		lineTax := (base*line.TaxBPS + 5000) / 10000
		subtotal += base
		tax += lineTax
		if subtotal+tax > MaxAmount {
			return invalid("document total exceeds the supported amount")
		}
	}
	if subtotal+tax == 0 {
		return invalid("document total must be positive")
	}
	d.Kind, d.Partner, d.Email, d.Reference = input.Kind, input.Partner, strings.TrimSpace(input.Email), strings.TrimSpace(input.Reference)
	d.Date, d.DueDate, d.Lines = input.Date, input.DueDate, lines
	d.Subtotal, d.Tax, d.Total = subtotal, tax, subtotal+tax
	return nil
}

func (d *Document) Post() error {
	if d.Status != "draft" {
		return invalid("only drafts can be posted")
	}
	if err := d.SetDraft(Draft{d.Kind, d.Partner, d.Email, d.Reference, d.Date, d.DueDate, d.Lines}); err != nil {
		return err
	}
	entries := []Entry{}
	if d.Kind == "invoice" {
		entries = append(entries, Entry{"1100", d.Total, 0}, Entry{"4000", 0, d.Subtotal})
		if d.Tax > 0 {
			entries = append(entries, Entry{"2100", 0, d.Tax})
		}
	} else {
		entries = append(entries, Entry{"5000", d.Subtotal, 0}, Entry{"2000", 0, d.Total})
		if d.Tax > 0 {
			entries = append(entries, Entry{"1200", d.Tax, 0})
		}
	}
	if !Balanced(entries) {
		return invalid("journal is not balanced")
	}
	d.Entries, d.Status = entries, "posted"
	return nil
}

func Balanced(entries []Entry) bool {
	var debit, credit int64
	for _, entry := range entries {
		if entry.Debit < 0 || entry.Credit < 0 || entry.Debit > MaxAmount || entry.Credit > MaxAmount || (entry.Debit > 0 && entry.Credit > 0) {
			return false
		}
		debit += entry.Debit
		credit += entry.Credit
	}
	return len(entries) > 0 && debit > 0 && debit == credit
}

func (d *Document) RecordPayment(payment Payment) error {
	if d.Status != "posted" {
		return invalid("payments require a posted document with an outstanding balance")
	}
	if len(d.Payments) >= 200 {
		return invalid("this document has reached the 200-payment limit")
	}
	if !ValidDate(payment.Date) || payment.Date < d.Date {
		return invalid("payment date must be on or after document date")
	}
	if payment.Amount <= 0 || payment.Amount > d.Total-d.Paid || utf8.RuneCountInString(payment.Reference) > 300 {
		return invalid("payment must be positive and cannot exceed the outstanding balance")
	}
	if payment.ID == "" || len(payment.ID) > 100 {
		return invalid("payment needs an idempotency key")
	}
	for _, existing := range d.Payments {
		if existing.ID == payment.ID {
			return invalid("payment key was already used")
		}
	}
	payment.Reference = strings.TrimSpace(payment.Reference)
	if d.Kind == "invoice" {
		payment.Entries = []Entry{{"1000", payment.Amount, 0}, {"1100", 0, payment.Amount}}
	} else {
		payment.Entries = []Entry{{"2000", payment.Amount, 0}, {"1000", 0, payment.Amount}}
	}
	d.Payments = append(d.Payments, payment)
	d.Paid += payment.Amount
	if d.Paid == d.Total {
		d.Status = "paid"
	}
	return nil
}
