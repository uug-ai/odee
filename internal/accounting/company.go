package accounting

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
)

// Applicability records an assessment boundary, never legal eligibility.
type AccountingMetadata struct {
	EnterpriseID     string `json:"enterpriseId" bson:"enterpriseId"`
	BankAccount      string `json:"bankAccount" bson:"bankAccount"`
	BIC              string `json:"bic" bson:"bic"`
	PaymentTerms     string `json:"paymentTerms" bson:"paymentTerms"`
	TaxApplicability string `json:"taxApplicability" bson:"taxApplicability"`
}

func (d *ContactData) validateAccounting(previous *ContactData) error {
	old := ContactData{}
	if previous != nil {
		old = *previous
	}
	for _, field := range [][2]string{{d.EnterpriseID, old.EnterpriseID}, {d.BankAccount, old.BankAccount}, {d.BIC, old.BIC}, {d.PaymentTerms, old.PaymentTerms}} {
		value := field[0]
		if previous != nil && value == field[1] {
			continue
		}
		if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 300 || strings.ContainsRune(value, 0) {
			return invalid("accounting metadata must contain at most 300 valid characters")
		}
	}
	if previous == nil || d.TaxApplicability != old.TaxApplicability {
		switch d.TaxApplicability {
		case "", "unknown", "unsupported":
		default:
			return invalid("tax applicability must be unknown or unsupported")
		}
	}
	// Historical/imported identifiers are retained verbatim on unrelated edits.
	changed := func(value string, old string) bool { return value != "" && (previous == nil || value != old) }
	country := strings.ToLower(strings.TrimSpace(d.Address.Country))
	belgian := country == "be" || country == "belgium" || country == "belgië" || country == "belgique" || country == "belgien"
	if belgian {
		if changed(d.EnterpriseID, old.EnterpriseID) && !validBelgianID(d.EnterpriseID, false) {
			return invalid("invalid Belgian enterprise identifier checksum")
		}
	}
	if changed(d.VAT, old.VAT) && (belgian || strings.HasPrefix(strings.ToUpper(d.VAT), "BE")) && !validBelgianID(d.VAT, true) {
		return invalid("invalid Belgian VAT identifier checksum")
	}
	if changed(d.BIC, old.BIC) && !regexp.MustCompile(`^[A-Za-z]{6}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$`).MatchString(d.BIC) {
		return invalid("BIC must contain 8 or 11 valid characters")
	}
	if changed(d.BankAccount, old.BankAccount) && strings.HasPrefix(strings.ToUpper(strings.ReplaceAll(d.BankAccount, " ", "")), "BE") {
		value := strings.ToUpper(strings.ReplaceAll(d.BankAccount, " ", ""))
		if !regexp.MustCompile(`^BE[0-9]{14}$`).MatchString(value) {
			return invalid("invalid Belgian IBAN checksum")
		}
		rearranged := value[4:] + "1114" + value[2:4]
		remainder := 0
		for _, digit := range rearranged {
			remainder = (remainder*10 + int(digit-'0')) % 97
		}
		if remainder != 1 {
			return invalid("invalid Belgian IBAN checksum")
		}
	}
	return nil
}

func validBelgianID(value string, vat bool) bool {
	value = strings.ToUpper(strings.NewReplacer(".", "", " ", "").Replace(value))
	if vat {
		if !strings.HasPrefix(value, "BE") {
			return false
		}
		value = strings.TrimPrefix(value, "BE")
	}
	if !regexp.MustCompile(`^[01][0-9]{9}$`).MatchString(value) {
		return false
	}
	base, _ := strconv.Atoi(value[:8])
	check, _ := strconv.Atoi(value[8:])
	return 97-base%97 == check
}

type CompanyProfile struct {
	ID             primitive.ObjectID `json:"id" bson:"_id"`
	OrganisationID primitive.ObjectID `json:"-" bson:"organisationId"`
	ProjectID      primitive.ObjectID `json:"-" bson:"projectId"`
	OwnerID        primitive.ObjectID `json:"-" bson:"ownerId,omitempty"`
	Data           ContactData        `json:"data" bson:"data"`
	Version        int64              `json:"version" bson:"version"`
	UpdatedAt      time.Time          `json:"updatedAt" bson:"updatedAt"`
}

func (p *CompanyProfile) normalize() {
	if p.OrganisationID.IsZero() {
		p.OrganisationID = p.OwnerID
	}
	if p.ProjectID.IsZero() {
		p.ProjectID = p.OwnerID
	}
}

type CompanyStore interface {
	Get(context.Context) (CompanyProfile, error)
	Save(context.Context, CompanyProfile, int64) error
}

type MongoCompany struct{ store *MongoStore }

func NewMongoCompany(store *MongoStore) *MongoCompany { return &MongoCompany{store} }
func (s *MongoCompany) Get(ctx context.Context) (CompanyProfile, error) {
	var p CompanyProfile
	err := s.store.Client.FindOne(ctx, s.store.Name, "company_profiles", bson.M{
		"$and": bson.A{ScopeFilter(s.store.Company), bson.M{"_id": s.store.Company}},
	}).Into(&p)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return p, ErrNotFound
	}
	p.normalize()
	return p, err
}
func (s *MongoCompany) Save(ctx context.Context, p CompanyProfile, version int64) error {
	p.normalize()
	if p.ID != s.store.Company || p.OrganisationID != s.store.Company || p.ProjectID != s.store.Company {
		return ErrNotFound
	}
	p.Version, p.UpdatedAt = version+1, time.Now().UTC()
	if version == 0 {
		_, err := s.store.Client.InsertOne(ctx, s.store.Name, "company_profiles", p)
		if mongo.IsDuplicateKeyError(err) {
			return ErrConflict
		}
		return err
	}
	filter := bson.M{"$and": bson.A{ScopeFilter(s.store.Company), bson.M{"_id": p.ID, "version": version}}}
	result, err := s.store.Client.UpdateOne(ctx, s.store.Name, "company_profiles", filter,
		bson.M{"$set": bson.M{"data": p.Data, "version": p.Version, "updatedAt": p.UpdatedAt}})
	if err != nil {
		return err
	}
	if result.MatchedCount() == 0 {
		return ErrConflict
	}
	return nil
}

type MemoryCompany struct {
	mu      sync.Mutex
	company primitive.ObjectID
	profile *CompanyProfile
}

func NewMemoryCompany(company primitive.ObjectID) *MemoryCompany {
	return &MemoryCompany{company: company}
}
func cloneData(data ContactData) ContactData {
	data.Tags = append([]string{}, data.Tags...)
	return data
}
func (s *MemoryCompany) Get(context.Context) (CompanyProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.profile == nil {
		return CompanyProfile{}, ErrNotFound
	}
	p := *s.profile
	p.normalize()
	if p.OrganisationID != s.company || p.ProjectID != s.company {
		return CompanyProfile{}, ErrNotFound
	}
	p.Data = cloneData(p.Data)
	return p, nil
}
func (s *MemoryCompany) Save(_ context.Context, p CompanyProfile, version int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.normalize()
	if p.ID != s.company || p.OrganisationID != s.company || p.ProjectID != s.company {
		return ErrNotFound
	}
	if (s.profile == nil && version != 0) || (s.profile != nil && s.profile.Version != version) {
		return ErrConflict
	}
	if s.profile != nil {
		current := *s.profile
		current.normalize()
		if current.OrganisationID != s.company || current.ProjectID != s.company {
			return ErrNotFound
		}
	}
	p.Data = cloneData(p.Data)
	p.Version, p.UpdatedAt = version+1, time.Now().UTC()
	s.profile = &p
	return nil
}
