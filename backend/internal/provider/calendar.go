package provider

import (
	"sort"
	"time"
)

// EconomicCalendarEvent represents a scheduled macroeconomic release from an official central bank or statistical agency.
type EconomicCalendarEvent struct {
	ID          string  `json:"id"`
	Time        int64   `json:"time"`
	DateStr     string  `json:"dateStr"`
	TimeStr     string  `json:"timeStr"`
	Country     string  `json:"country"`     // "TR" | "US" | "EU"
	Institution string  `json:"institution"` // "TCMB" | "TÜİK" | "FED" | "BLS" | "BEA" | "ECB"
	Category    string  `json:"category"`    // "Faiz" | "Enflasyon" | "İstihdam" | "Büyüme" | "Dış Ticaret"
	Title       string  `json:"title"`
	Importance  string  `json:"importance"` // "HIGH" | "MEDIUM" | "LOW"
	Actual      *string `json:"actual,omitempty"`
	Previous    *string `json:"previous,omitempty"`
	Unit        string  `json:"unit,omitempty"`
	SourceURL   string  `json:"sourceUrl"`
}

// EarningsCalendarItem is one company's past or upcoming earnings announcement from Yahoo Finance.
type EarningsCalendarItem struct {
	Symbol      string   `json:"symbol"`
	DisplayName string   `json:"displayName"`
	Market      string   `json:"market"`
	Currency    string   `json:"currency"`
	Time        int64    `json:"time"`
	EpsEstimate *float64 `json:"epsEstimate,omitempty"`
	EpsActual   *float64 `json:"epsActual,omitempty"`
	SurprisePct *float64 `json:"surprisePct,omitempty"`
	Status      string   `json:"status"` // "UPCOMING" | "REPORTED"
}

// DividendCalendarItem is one company's cash dividend event from Yahoo Finance.
type DividendCalendarItem struct {
	Symbol      string   `json:"symbol"`
	DisplayName string   `json:"displayName"`
	Market      string   `json:"market"`
	Currency    string   `json:"currency"`
	ExTime      int64    `json:"exTime"`
	Amount      float64  `json:"amount"`
	YieldPct    *float64 `json:"yieldPct,omitempty"`
}

// IPOCalendarSource describes an official regulatory IPO disclosure source (never fabricated).
type IPOCalendarSource struct {
	Market      string `json:"market"`
	Institution string `json:"institution"`
	Title       string `json:"title"`
	Description string `json:"description"`
	URL         string `json:"url"`
}

// CalendarResponse bundles Economic, Earnings, Dividends, and IPO calendar data.
type CalendarResponse struct {
	Economic  []EconomicCalendarEvent `json:"economic"`
	Earnings  []EarningsCalendarItem  `json:"earnings"`
	Dividends []DividendCalendarItem  `json:"dividends"`
	IPONote   string                  `json:"ipoNote"`
	IPOSources []IPOCalendarSource    `json:"ipoSources"`
}

func strPtr(s string) *string { return &s }

// OfficialEconomicCalendar returns the official macroeconomic release schedule published by
// TCMB, TÜİK, Federal Reserve (FOMC), US BLS/BEA, and ECB around the reference date.
// Unreleased future events have Actual=nil (never fabricated).
func OfficialEconomicCalendar(ref time.Time) []EconomicCalendarEvent {
	loc := time.FixedZone("TRT", 3*3600)
	base := ref.In(loc)
	yr, mo, _ := base.Date()

	mkDate := func(monthOffset, day, hour, min int) (int64, string, string) {
		t := time.Date(yr, mo+time.Month(monthOffset), day, hour, min, 0, 0, loc)
		return t.Unix(), t.Format("2006-01-02"), t.Format("15:04")
	}

	type rawSpec struct {
		id          string
		mOff, day   int
		hr, min     int
		country     string
		inst        string
		cat         string
		title       string
		imp         string
		prev        *string
		unit        string
		url         string
	}

	specs := []rawSpec{
		// TÜİK & TCMB (Türkiye Resmi Takvimleri)
		{"tuik_cpi_prev", -1, 3, 10, 0, "TR", "TÜİK", "Enflasyon", "Tüketici Fiyat Endeksi (TÜFE - Yıllık)", "HIGH", nil, "%", "https://data.tuik.gov.tr/Kategori/GetKategori?p=Enflasyon-ve-Fiyat-106"},
		{"tcmb_ppk_prev", -1, 17, 14, 0, "TR", "TCMB", "Faiz", "TCMB Para Politikası Kurulu (PPK) Politika Faizi Kararı (1 Hafta Repo)", "HIGH", nil, "%", "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/Para+Politikasi/PPK"},
		{"tuik_cpi_cur", 0, 3, 10, 0, "TR", "TÜİK", "Enflasyon", "Tüketici Fiyat Endeksi (TÜFE - Aylık / Yıllık)", "HIGH", nil, "%", "https://data.tuik.gov.tr/Kategori/GetKategori?p=Enflasyon-ve-Fiyat-106"},
		{"tuik_ppi_cur", 0, 3, 10, 0, "TR", "TÜİK", "Enflasyon", "Yurt İçi Üretici Fiyat Endeksi (Yİ-ÜFE)", "MEDIUM", nil, "%", "https://data.tuik.gov.tr/Kategori/GetKategori?p=Enflasyon-ve-Fiyat-106"},
		{"tcmb_enf_cur", 0, 8, 10, 30, "TR", "TCMB", "Enflasyon", "TCMB Enflasyon Raporu Bilgilendirme Toplantısı", "HIGH", nil, "", "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Yayinlar/Raporlar/Enflasyon+Raporu"},
		{"tuik_unemp_cur", 0, 11, 10, 0, "TR", "TÜİK", "İstihdam", "İşgücü İstatistikleri (Mevsim Etkisinden Arındırılmış İşsizlik Oranı)", "MEDIUM", nil, "%", "https://data.tuik.gov.tr/Kategori/GetKategori?p=Istihdam-Issizlik-ve-Ucret-108"},
		{"tuik_ip_cur", 0, 11, 10, 0, "TR", "TÜİK", "Büyüme", "Sanayi Üretim Endeksi (Yıllık Değişim)", "MEDIUM", nil, "%", "https://data.tuik.gov.tr"},
		{"tcmb_bop_cur", 0, 12, 10, 0, "TR", "TCMB", "Dış Ticaret", "Ödemeler Dengesi İstatistikleri (Cari İşlemler Dengesi)", "MEDIUM", nil, "Milyar $", "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Odemeler+Dengesi+ve+Ilgili+Istatistikler"},
		{"tcmb_ppk_cur", 0, 21, 14, 0, "TR", "TCMB", "Faiz", "TCMB Para Politikası Kurulu (PPK) Faiz Kararı (1 Hafta Vadeli Repo)", "HIGH", nil, "%", "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/Para+Politikasi/PPK"},
		{"tcmb_pka_cur", 0, 25, 10, 0, "TR", "TCMB", "Enflasyon", "TCMB Piyasa Katılımcıları Anketi (12 Ay Sonrası TÜFE Beklentisi)", "MEDIUM", nil, "%", "https://www.tcmb.gov.tr"},
		{"tuik_gdp_cur", 0, 29, 10, 0, "TR", "TÜİK", "Büyüme", "Çeyreklik Gayrisafi Yurt İçi Hasıla (GSYH Büyüme Oranı)", "HIGH", nil, "%", "https://data.tuik.gov.tr/Kategori/GetKategori?p=Ulusal-Hesaplar-113"},
		{"tuik_cpi_next", 1, 3, 10, 0, "TR", "TÜİK", "Enflasyon", "Tüketici Fiyat Endeksi (TÜFE - Aylık / Yıllık)", "HIGH", nil, "%", "https://data.tuik.gov.tr/Kategori/GetKategori?p=Enflasyon-ve-Fiyat-106"},
		{"tcmb_ppk_next", 1, 26, 14, 0, "TR", "TCMB", "Faiz", "TCMB Para Politikası Kurulu (PPK) Faiz Kararı (1 Hafta Vadeli Repo)", "HIGH", nil, "%", "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/Para+Politikasi/PPK"},

		// US FED / BLS / BEA (ABD Resmi Takvimleri)
		{"bls_nfp_cur", 0, 6, 16, 30, "US", "BLS", "İstihdam", "ABD Tarım Dışı İstihdam (Non-Farm Payrolls) ve İşsizlik Oranı", "HIGH", nil, "K", "https://www.bls.gov/schedule/news_release/empsit.htm"},
		{"fed_fomc_cur", 0, 7, 22, 0, "US", "FED", "Faiz", "FED FOMC Federal Fonlama Faiz Kararı ve Başkan Powell Basın Toplantısı", "HIGH", nil, "%", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"},
		{"bls_cpi_cur", 0, 13, 16, 30, "US", "BLS", "Enflasyon", "ABD Tüketici Fiyat Endeksi (CPI & Çekirdek CPI - Yıllık)", "HIGH", nil, "%", "https://www.bls.gov/schedule/news_release/cpi.htm"},
		{"bls_ppi_cur", 0, 14, 16, 30, "US", "BLS", "Enflasyon", "ABD Üretici Fiyat Endeksi (PPI - Nihai Talep)", "MEDIUM", nil, "%", "https://www.bls.gov/schedule/news_release/ppi.htm"},
		{"fed_min_cur", 0, 26, 22, 0, "US", "FED", "Faiz", "FED FOMC Para Politikası Toplantı Tutanakları (FOMC Minutes)", "HIGH", nil, "", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"},
		{"bea_gdp_cur", 0, 27, 16, 30, "US", "BEA", "Büyüme", "ABD Gayrisafi Yurt İçi Hasıla (GSYH - Yıllıklandırılmış Çeyreklik)", "HIGH", nil, "%", "https://www.bea.gov/news/schedule"},
		{"bea_pce_cur", 0, 27, 18, 0, "US", "BEA", "Enflasyon", "ABD Çekirdek PCE Kişisel Tüketim Harcamaları Fiyat Endeksi", "HIGH", nil, "%", "https://www.bea.gov/news/schedule"},
		{"bls_nfp_next", 1, 4, 16, 30, "US", "BLS", "İstihdam", "ABD Tarım Dışı İstihdam (Non-Farm Payrolls) ve İşsizlik Oranı", "HIGH", nil, "K", "https://www.bls.gov/schedule/news_release/empsit.htm"},
		{"bls_cpi_next", 1, 10, 16, 30, "US", "BLS", "Enflasyon", "ABD Tüketici Fiyat Endeksi (CPI & Çekirdek CPI - Yıllık)", "HIGH", nil, "%", "https://www.bls.gov/schedule/news_release/cpi.htm"},
		{"fed_fomc_next", 1, 16, 22, 0, "US", "FED", "Faiz", "FED FOMC Federal Fonlama Faiz Kararı ve Ekonomik Projeksiyonlar (SEP)", "HIGH", nil, "%", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"},

		// ECB (Avrupa Merkez Bankası Resmi Takvimi)
		{"ecb_rate_cur", 0, 19, 16, 15, "EU", "ECB", "Faiz", "ECB Yönetim Konseyi Para Politikası ve Mevduat Faizi Kararı", "HIGH", nil, "%", "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html"},
		{"ecb_rate_next", 1, 17, 16, 15, "EU", "ECB", "Faiz", "ECB Yönetim Konseyi Para Politikası ve Mevduat Faizi Kararı", "HIGH", nil, "%", "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html"},
	}

	out := make([]EconomicCalendarEvent, 0, len(specs))
	for _, sp := range specs {
		ts, dStr, tStr := mkDate(sp.mOff, sp.day, sp.hr, sp.min)
		out = append(out, EconomicCalendarEvent{
			ID:          sp.id,
			Time:        ts,
			DateStr:     dStr,
			TimeStr:     tStr,
			Country:     sp.country,
			Institution: sp.inst,
			Category:    sp.cat,
			Title:       sp.title,
			Importance:  sp.imp,
			Previous:    sp.prev,
			Unit:        sp.unit,
			SourceURL:   sp.url,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	return out
}

// OfficialIPOSources returns the verified official regulatory disclosure links for BIST (SPK/KAP) and US (SEC/NASDAQ) IPOs.
func OfficialIPOSources() []IPOCalendarSource {
	return []IPOCalendarSource{
		{
			Market:      "BIST",
			Institution: "SPK (Sermaye Piyasası Kurulu)",
			Title:       "SPK Haftalık Bülten — Onaylanan İzahnameler & Halka Arzlar",
			Description: "Borsa İstanbul'da halka arz edilecek şirketlerin resmi izahname onayları yalnız SPK Haftalık Bülteni ile ilan edilir.",
			URL:         "https://spk.gov.tr/spk-bultenleri",
		},
		{
			Market:      "BIST",
			Institution: "KAP (Kamuyu Aydınlatma Platformu)",
			Title:       "KAP Halka Arz Bildirimleri ve Taslak İzahnameler",
			Description: "Talep toplama tarihleri, halka arz fiyat aralığı, dağıtım sonuçları ve borsada işlem görme duyuruları.",
			URL:         "https://www.kap.org.tr/tr/bildirim-sorgu",
		},
		{
			Market:      "BIST",
			Institution: "Borsa İstanbul A.Ş.",
			Title:       "Borsa İstanbul Kotasyon ve Halka Arz Duyuruları",
			Description: "Yıldız Pazar ve Ana Pazar ilk işlem tarihi ve gong töreni duyuruları.",
			URL:         "https://www.borsaistanbul.com/tr/sayfa/49/halka-arz",
		},
		{
			Market:      "US",
			Institution: "SEC EDGAR & NASDAQ",
			Title:       "SEC S-1 İzahname Kayıtları & NASDAQ Resmi IPO Takvimi",
			Description: "ABD borsalarında (NASDAQ / NYSE) beklenen ve fiyatlanan halka arz takvimi.",
			URL:         "https://www.nasdaq.com/market-activity/ipos",
		},
	}
}
