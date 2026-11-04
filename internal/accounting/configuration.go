package accounting

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
)

const starterPolicy = "legacy-starter-v1"

type ConfigAccount struct {
	Code   string `json:"code" bson:"code"`
	Name   string `json:"name" bson:"name"`
	Type   string `json:"type" bson:"type"`
	Active bool   `json:"active" bson:"active"`
}
type ConfigJournal struct {
	Code   string `json:"code" bson:"code"`
	Name   string `json:"name" bson:"name"`
	Kind   string `json:"kind" bson:"kind"`
	Active bool   `json:"active" bson:"active"`
}
type FiscalPeriod struct {
	Start  string `json:"start" bson:"start"`
	End    string `json:"end" bson:"end"`
	Active bool   `json:"active" bson:"active"`
}
type FiscalYear struct {
	Start   string         `json:"start" bson:"start"`
	End     string         `json:"end" bson:"end"`
	Periods []FiscalPeriod `json:"periods" bson:"periods"`
}
type ConfigurationData struct {
	Accounts []ConfigAccount   `json:"accounts" bson:"accounts"`
	Mappings map[string]string `json:"mappings" bson:"mappings"`
	Journals []ConfigJournal   `json:"journals" bson:"journals"`
	Years    []FiscalYear      `json:"years" bson:"years"`
	Note     string            `json:"note" bson:"note"`
}
type ConfigurationStage struct {
	Version       int64              `json:"version" bson:"version"`
	PublicationID primitive.ObjectID `json:"publicationId" bson:"publicationId"`
	Data          ConfigurationData  `json:"data" bson:"data"`
	Digest        string             `json:"digest" bson:"digest"`
	UpdatedAt     time.Time          `json:"updatedAt" bson:"updatedAt"`
}
type ConfigurationDefault struct {
	Revision  int64               `json:"revision" bson:"revision"`
	VersionID *primitive.ObjectID `json:"versionId" bson:"versionId"`
}
type ConfigurationHead struct {
	ID             primitive.ObjectID   `json:"-" bson:"_id"`
	OrganisationID primitive.ObjectID   `json:"-" bson:"organisationId"`
	ProjectID      primitive.ObjectID   `json:"-" bson:"projectId"`
	OwnerID        primitive.ObjectID   `json:"-" bson:"ownerId,omitempty"`
	SchemaVersion  int                  `json:"schemaVersion" bson:"schemaVersion"`
	Stage          ConfigurationStage   `json:"stage" bson:"stage"`
	Default        ConfigurationDefault `json:"default" bson:"default"`
}
type ConfigurationPayload struct {
	SchemaVersion      int                `json:"schemaVersion" bson:"schemaVersion"`
	SourceStageID      primitive.ObjectID `json:"sourceStageId" bson:"sourceStageId"`
	SourceStageVersion int64              `json:"sourceStageVersion" bson:"sourceStageVersion"`
	Digest             string             `json:"digest" bson:"digest"`
	PublishedAt        time.Time          `json:"publishedAt" bson:"publishedAt"`
	Data               ConfigurationData  `json:"data" bson:"data"`
}
type PublishedConfiguration struct {
	ID              primitive.ObjectID   `json:"id" bson:"_id"`
	OrganisationID  primitive.ObjectID   `json:"-" bson:"organisationId"`
	ProjectID       primitive.ObjectID   `json:"-" bson:"projectId"`
	OwnerID         primitive.ObjectID   `json:"-" bson:"ownerId,omitempty"`
	Payload         ConfigurationPayload `json:"payload" bson:"payload"`
	DurabilityNonce primitive.ObjectID   `json:"-" bson:"_durabilityNonce,omitempty"`
}
type ConfigurationSelection struct {
	Policy    string              `json:"policy,omitempty" bson:"policy,omitempty"`
	VersionID *primitive.ObjectID `json:"versionId,omitempty" bson:"versionId,omitempty"`
	Digest    string              `json:"digest" bson:"digest"`
}
type FinancialSnapshot struct {
	SchemaVersion int                    `json:"schemaVersion" bson:"schemaVersion"`
	Selection     ConfigurationSelection `json:"selection" bson:"selection"`
	Accounts      []ConfigAccount        `json:"accounts" bson:"accounts"`
	Mappings      map[string]string      `json:"mappings" bson:"mappings"`
	Journals      []ConfigJournal        `json:"journals" bson:"journals"`
	Period        FiscalPeriod           `json:"period" bson:"period"`
}

func scopeIDs(org, project, owner primitive.ObjectID, company primitive.ObjectID) bool {
	if org.IsZero() {
		org = owner
	}
	if project.IsZero() {
		project = owner
	}
	return !company.IsZero() && org == company && project == company
}
func starterConfiguration() ConfigurationData {
	data := ConfigurationData{
		Accounts: []ConfigAccount{}, Journals: []ConfigJournal{
			{"sales", "Sales", "invoice", true}, {"purchase", "Purchases", "bill", true}, {"bank", "Bank", "payment", true},
		},
		Mappings: map[string]string{"bank": "1000", "receivable": "1100", "vatRecoverable": "1200", "payable": "2000", "vatPayable": "2100", "revenue": "4000", "expense": "5000", "invoiceJournal": "sales", "billJournal": "purchase", "paymentJournal": "bank"},
		Years:    []FiscalYear{{"2000-01-01", "9999-12-31", []FiscalPeriod{{"2000-01-01", "9999-12-31", true}}}},
		Note:     "SYNTHETIC starter policy; not a Belgian statutory chart.",
	}
	for _, a := range Accounts {
		data.Accounts = append(data.Accounts, ConfigAccount{a.Code, a.Name, a.Type, true})
	}
	return data
}
func starterSelection() ConfigurationSelection {
	return ConfigurationSelection{Policy: starterPolicy, Digest: configurationDigest(starterConfiguration())}
}
func configurationDigest(data ConfigurationData) string {
	raw, _ := json.Marshal(data)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func copyConfiguration[T any](value T) T {
	raw, err := bson.Marshal(value)
	if err != nil {
		panic(err)
	}
	var result T
	if err = bson.Unmarshal(raw, &result); err != nil {
		panic(err)
	}
	return result
}
func (d *ConfigurationData) normalize() error {
	if len(d.Accounts) > 256 || len(d.Journals) > 16 || len(d.Years) > 10 || utf8.RuneCountInString(d.Note) > 2000 || !utf8.ValidString(d.Note) {
		return invalid("configuration size limit exceeded")
	}
	for _, a := range d.Accounts {
		if !regexp.MustCompile(`^[0-9]{1,12}$`).MatchString(a.Code) || strings.TrimSpace(a.Name) == "" || utf8.RuneCountInString(a.Name) > 200 || !utf8.ValidString(a.Name) {
			return invalid("invalid configuration account code or name")
		}
	}
	for _, j := range d.Journals {
		if !regexp.MustCompile(`^[A-Za-z0-9_-]{1,24}$`).MatchString(j.Code) || strings.TrimSpace(j.Name) == "" || utf8.RuneCountInString(j.Name) > 200 || !utf8.ValidString(j.Name) {
			return invalid("invalid configuration journal code or name")
		}
	}
	for key, value := range d.Mappings {
		if _, ok := roleTypes[key]; !ok && key != "invoiceJournal" && key != "billJournal" && key != "paymentJournal" {
			return invalid("unknown configuration mapping")
		}
		if len(value) > 24 {
			return invalid("configuration mapping is too long")
		}
	}
	count := 0
	for _, year := range d.Years {
		count += len(year.Periods)
		if len(year.Periods) > 24 {
			return invalid("configuration period limit exceeded")
		}
	}
	if count > 120 {
		return invalid("configuration period limit exceeded")
	}
	sort.Slice(d.Accounts, func(i, j int) bool { return d.Accounts[i].Code < d.Accounts[j].Code })
	sort.Slice(d.Journals, func(i, j int) bool { return d.Journals[i].Code < d.Journals[j].Code })
	sort.Slice(d.Years, func(i, j int) bool { return d.Years[i].Start < d.Years[j].Start })
	for i := range d.Years {
		sort.Slice(d.Years[i].Periods, func(a, b int) bool { return d.Years[i].Periods[a].Start < d.Years[i].Periods[b].Start })
	}
	raw, err := json.Marshal(d)
	if err != nil || len(raw) > 96*1024 {
		return invalid("configuration size limit exceeded")
	}
	return nil
}

var roleTypes = map[string]string{"bank": "asset", "receivable": "asset", "payable": "liability", "revenue": "income", "expense": "expense", "vatPayable": "liability", "vatRecoverable": "asset"}

func (d ConfigurationData) structuralErrors() []string {
	errors := []string{}
	seen := map[string]bool{}
	for _, a := range d.Accounts {
		if seen[a.Code] {
			errors = append(errors, "duplicate account code")
		}
		seen[a.Code] = true
		if a.Type != "asset" && a.Type != "liability" && a.Type != "equity" && a.Type != "income" && a.Type != "expense" {
			errors = append(errors, "invalid account type")
		}
	}
	seen = map[string]bool{}
	for _, j := range d.Journals {
		if seen[j.Code] {
			errors = append(errors, "duplicate journal code")
		}
		seen[j.Code] = true
		if j.Kind != "invoice" && j.Kind != "bill" && j.Kind != "payment" {
			errors = append(errors, "unsupported journal kind")
		}
	}
	for i, year := range d.Years {
		if !ValidDate(year.Start) || !ValidDate(year.End) || year.End < year.Start {
			errors = append(errors, "invalid fiscal year")
		}
		if i > 0 && year.Start <= d.Years[i-1].End {
			errors = append(errors, "overlapping fiscal years")
		}
		for p, period := range year.Periods {
			if !ValidDate(period.Start) || !ValidDate(period.End) || period.End < period.Start || period.Start < year.Start || period.End > year.End {
				errors = append(errors, "invalid fiscal period")
			}
			if p > 0 && period.Start <= year.Periods[p-1].End {
				errors = append(errors, "overlapping fiscal periods")
			}
		}
	}
	return errors
}
func (d ConfigurationData) readiness(kind string) []string {
	errors := append([]string{}, d.structuralErrors()...)
	roles := []string{"bank", "receivable", "revenue", "vatPayable"}
	if kind == "bill" {
		roles = []string{"bank", "payable", "expense", "vatRecoverable"}
	}
	for _, role := range roles {
		a, ok := d.account(d.Mappings[role])
		if !ok || !a.Active || a.Type != roleTypes[role] {
			errors = append(errors, "missing or inactive mapping: "+role)
		}
	}
	for _, op := range []string{kind, "payment"} {
		j, ok := d.journal(d.Mappings[op+"Journal"])
		if !ok || !j.Active || j.Kind != op {
			errors = append(errors, "missing or inactive journal: "+op)
		}
	}
	supported := false
	for _, year := range d.Years {
		for _, p := range year.Periods {
			supported = supported || p.Active
		}
	}
	if !supported {
		errors = append(errors, "no supported fiscal period")
	}
	return errors
}
func (d ConfigurationData) account(code string) (ConfigAccount, bool) {
	for _, a := range d.Accounts {
		if a.Code == code {
			return a, true
		}
	}
	return ConfigAccount{}, false
}
func (d ConfigurationData) journal(code string) (ConfigJournal, bool) {
	for _, j := range d.Journals {
		if j.Code == code {
			return j, true
		}
	}
	return ConfigJournal{}, false
}
func (p PublishedConfiguration) validate(company primitive.ObjectID) error {
	if !scopeIDs(p.OrganisationID, p.ProjectID, p.OwnerID, company) || p.ID.IsZero() {
		return ErrNotFound
	}
	if p.Payload.SchemaVersion != 1 || p.Payload.SourceStageID != company || p.Payload.SourceStageVersion < 1 || p.Payload.PublishedAt.IsZero() || p.Payload.Digest != configurationDigest(p.Payload.Data) || len(p.Payload.Data.structuralErrors()) > 0 {
		return invalid("published configuration integrity check failed")
	}
	data := copyConfiguration(p.Payload.Data)
	if err := data.normalize(); err != nil || !reflect.DeepEqual(data, p.Payload.Data) {
		return invalid("published configuration integrity check failed")
	}
	return nil
}
func (p *PublishedConfiguration) normalizeOwnership() {
	if p.OrganisationID.IsZero() {
		p.OrganisationID = p.OwnerID
	}
	if p.ProjectID.IsZero() {
		p.ProjectID = p.OwnerID
	}
}
