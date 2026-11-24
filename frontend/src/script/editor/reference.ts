/**
 * TitanScript yerleşik referans kılavuzu.
 * Editör tamamlama, imza yardımı, hover dokümanı ve "Referans" panelinin tek kaynağı.
 * Satır biçimi: `ad(param1, param2?) → dönüş | açıklama` (değişken/sabitler: `ad → tip | açıklama`).
 * `?` ile biten parametre isteğe bağlıdır.
 */

export type RefKind = 'function' | 'variable' | 'constant' | 'keyword' | 'type' | 'namespace';

export interface RefParam {
  name: string;
  optional: boolean;
}

export interface RefEntry {
  name: string;
  kind: RefKind;
  params: RefParam[];
  returns: string;
  doc: string;
  /** Tam imza metni: `ta.sma(source, length) → series float` */
  signature: string;
}

const FUNCS = `
indicator(title, shorttitle?, overlay?, format?, precision?, scale?, max_bars_back?, timeframe?, timeframe_gaps?, explicit_plot_zorder?, max_lines_count?, max_labels_count?, max_boxes_count?, max_polylines_count?) → void | Betiği gösterge olarak bildirir. Her göstergede zorunlu ilk çağrıdır.
strategy(title, shorttitle?, overlay?, format?, precision?, scale?, pyramiding?, calc_on_order_fills?, calc_on_every_tick?, max_bars_back?, backtest_fill_limits_assumption?, default_qty_type?, default_qty_value?, initial_capital?, currency?, slippage?, commission_type?, commission_value?, process_orders_on_close?, close_entries_rule?, margin_long?, margin_short?, max_lines_count?, max_labels_count?, max_boxes_count?) → void | Betiği strateji olarak bildirir; Strateji Testi sekmesi doldurulur.
library(title, overlay?) → void | Betiği kütüphane olarak bildirir; export edilen üyeler import ile kullanılır.
plot(series, title?, color?, linewidth?, style?, trackprice?, histbase?, offset?, join?, editable?, show_last?, display?, force_overlay?) → plot | Seriyi grafiğe çizer.
plotshape(series, title?, style?, location?, color?, offset?, text?, textcolor?, editable?, size?, show_last?, display?) → void | Koşul doğru olan barlarda şekil çizer.
plotchar(series, title?, char?, location?, color?, offset?, text?, textcolor?, editable?, size?, show_last?, display?) → void | Koşul doğru olan barlarda karakter çizer.
plotarrow(series, title?, colorup?, colordown?, offset?, minheight?, maxheight?, editable?, show_last?, display?) → void | Pozitif değerde yukarı, negatifte aşağı ok çizer.
plotcandle(open, high, low, close, title?, color?, wickcolor?, editable?, show_last?, bordercolor?, display?) → void | Özel mum serisi çizer.
plotbar(open, high, low, close, title?, color?, editable?, show_last?, display?) → void | Özel OHLC çubuk serisi çizer.
hline(price, title?, color?, linestyle?, linewidth?, editable?, display?) → hline | Sabit fiyat seviyesinde yatay çizgi çizer.
fill(hline1, hline2, color?, title?, editable?, fillgaps?, display?) → void | İki plot ya da hline arasını boyar.
bgcolor(color, offset?, editable?, show_last?, title?, display?) → void | Bar arka planını boyar.
barcolor(color, offset?, editable?, show_last?, title?, display?) → void | Mum rengini değiştirir.
alert(message, freq?) → void | Gerçek zamanlı barda alarm tetikler.
alertcondition(condition, title?, message?) → void | Alarm iletişim kutusunda seçilebilir koşul tanımlar.
nz(source, replacement?) → series float | na değerini 0 (veya replacement) ile değiştirir.
na(x) → bool | Değer na ise true.
fixnan(source) → series float | na değerleri son geçerli değerle doldurur.
int(x) → int | Tam sayıya çevirir (kırpar).
float(x) → float | Ondalığa çevirir.
bool(x) → bool | Mantıksal değere çevirir.
color(x) → color | Renge çevirir.
string(x) → string | Metne çevirir.
timestamp(timezone?, year, month, day, hour?, minute?, second?) → int | UNIX ms zaman damgası üretir.
time(timeframe?, session?, timezone?) → series int | Bar açılış zamanı (ms); seans dışında na.
time_close(timeframe?, session?, timezone?) → series int | Bar kapanış zamanı (ms).
year(time?, timezone?) → int | Yıl.
month(time?, timezone?) → int | Ay (1-12).
weekofyear(time?, timezone?) → int | Yılın haftası.
dayofmonth(time?, timezone?) → int | Ayın günü.
dayofweek(time?, timezone?) → int | Haftanın günü (dayofweek.sunday=1).
hour(time?, timezone?) → int | Saat.
minute(time?, timezone?) → int | Dakika.
second(time?, timezone?) → int | Saniye.
max_bars_back(var, num) → void | Değişken için geçmiş tampon boyutunu ayarlar.
ta.sma(source, length) → series float | Basit hareketli ortalama.
ta.ema(source, length) → series float | Üssel hareketli ortalama (alpha = 2/(length+1)).
ta.rma(source, length) → series float | RSI'da kullanılan Wilder ortalaması (alpha = 1/length).
ta.wma(source, length) → series float | Ağırlıklı hareketli ortalama.
ta.vwma(source, length) → series float | Hacim ağırlıklı hareketli ortalama.
ta.hma(source, length) → series float | Hull hareketli ortalaması.
ta.swma(source) → series float | Simetrik ağırlıklı 4 bar ortalaması.
ta.alma(series, length, offset, sigma, floor?) → series float | Arnaud Legoux hareketli ortalaması.
ta.linreg(source, length, offset) → series float | Doğrusal regresyon eğrisi.
ta.rsi(source, length) → series float | Göreceli güç endeksi (0-100).
ta.macd(source, fastlen, slowlen, siglen) → [series float, series float, series float] | MACD: [macd, sinyal, histogram].
ta.stoch(source, high, low, length) → series float | Stokastik %K.
ta.cci(source, length) → series float | Emtia kanal endeksi.
ta.cmo(source, length) → series float | Chande momentum osilatörü.
ta.mfi(series, length) → series float | Para akışı endeksi.
ta.mom(source, length) → series float | Momentum: source - source[length].
ta.roc(source, length) → series float | Değişim oranı (%).
ta.tsi(source, short_length, long_length) → series float | Gerçek güç endeksi (-1..1).
ta.wpr(length) → series float | Williams %R.
ta.cog(source, length) → series float | Ağırlık merkezi.
ta.atr(length) → series float | Ortalama gerçek aralık.
ta.tr(handle_na?) → series float | Gerçek aralık.
ta.bb(series, length, mult) → [series float, series float, series float] | Bollinger: [orta, üst, alt].
ta.bbw(series, length, mult) → series float | Bollinger bant genişliği.
ta.kc(series, length, mult, useTrueRange?) → [series float, series float, series float] | Keltner kanalı: [orta, üst, alt].
ta.kcw(series, length, mult, useTrueRange?) → series float | Keltner kanal genişliği.
ta.dmi(diLength, adxSmoothing) → [series float, series float, series float] | Yön hareketi: [+DI, -DI, ADX].
ta.supertrend(factor, atrPeriod) → [series float, series float] | Supertrend: [çizgi, yön (-1 yukarı, 1 aşağı)].
ta.sar(start, inc, max) → series float | Parabolik SAR.
ta.vwap(source, anchor?, stdev_mult?) → series float | Hacim ağırlıklı ortalama fiyat (seans çapalı).
ta.stdev(source, length, biased?) → series float | Standart sapma.
ta.variance(source, length, biased?) → series float | Varyans.
ta.dev(source, length) → series float | Ortalama mutlak sapma.
ta.correlation(source1, source2, length) → series float | Korelasyon katsayısı.
ta.highest(source, length) → series float | Son length barın en yükseği.
ta.lowest(source, length) → series float | Son length barın en düşüğü.
ta.highestbars(source, length) → series int | En yüksek değere bar uzaklığı (negatif).
ta.lowestbars(source, length) → series int | En düşük değere bar uzaklığı (negatif).
ta.range(source, length) → series float | En yüksek - en düşük.
ta.median(source, length) → series float | Medyan.
ta.mode(source, length) → series float | Mod (en sık değer).
ta.percentrank(source, length) → series float | Yüzde sıralaması.
ta.percentile_linear_interpolation(source, length, percentage) → series float | Doğrusal ara değerli yüzdelik.
ta.percentile_nearest_rank(source, length, percentage) → series float | En yakın sıra yöntemiyle yüzdelik.
ta.crossover(source1, source2) → series bool | source1 source2'yi yukarı kestiyse true.
ta.crossunder(source1, source2) → series bool | source1 source2'yi aşağı kestiyse true.
ta.cross(source1, source2) → series bool | İki seri kesiştiyse true.
ta.change(source, length?) → series float | source - source[length].
ta.cum(source) → series float | Kümülatif toplam.
ta.sum(source, length) → series float | Kayan toplam (math.sum ile aynı).
ta.barssince(condition) → series int | Koşulun son doğru olduğundan beri geçen bar.
ta.valuewhen(condition, source, occurrence) → series float | Koşulun n'inci doğru olduğu bardaki değer.
ta.pivothigh(source?, leftbars, rightbars) → series float | Pivot tepe (rightbars sonra onaylanır).
ta.pivotlow(source?, leftbars, rightbars) → series float | Pivot dip.
ta.pivot_point_levels(type, anchor, developing?) → array<float> | Pivot seviyeleri (Traditional, Fibonacci, Woodie, Classic, DM, Camarilla).
ta.rising(source, length) → series bool | length bar boyunca yükseliyorsa true.
ta.falling(source, length) → series bool | length bar boyunca düşüyorsa true.
ta.rci(source, length) → series float | Sıralama korelasyon endeksi.
ta.max(source) → series float | Tüm geçmişin en büyüğü.
ta.min(source) → series float | Tüm geçmişin en küçüğü.
math.abs(number) → float | Mutlak değer.
math.max(number0, number1, ...) → float | En büyük.
math.min(number0, number1, ...) → float | En küçük.
math.avg(number0, number1, ...) → float | Ortalama.
math.sum(source, length) → series float | Kayan toplam.
math.round(number, precision?) → float | Yuvarlar.
math.round_to_mintick(number) → float | Sembolün en küçük adımına yuvarlar.
math.floor(number) → int | Aşağı yuvarlar.
math.ceil(number) → int | Yukarı yuvarlar.
math.sign(number) → float | İşaret (-1, 0, 1).
math.sqrt(number) → float | Karekök.
math.pow(base, exponent) → float | Üs.
math.exp(number) → float | e üzeri.
math.log(number) → float | Doğal logaritma.
math.log10(number) → float | 10 tabanında logaritma.
math.sin(angle) → float | Sinüs.
math.cos(angle) → float | Kosinüs.
math.tan(angle) → float | Tanjant.
math.asin(angle) → float | Ark sinüs.
math.acos(angle) → float | Ark kosinüs.
math.atan(angle) → float | Ark tanjant.
math.todegrees(radians) → float | Radyanı dereceye çevirir.
math.toradians(degrees) → float | Dereceyi radyana çevirir.
math.random(min?, max?, seed?) → float | Sahte rastgele sayı.
input(defval, title?, tooltip?, inline?, group?, display?) → input | Ayarlar penceresine girdi ekler.
input.int(defval, title?, minval?, maxval?, step?, tooltip?, inline?, group?, confirm?, display?, active?) → input int | Tam sayı girdisi.
input.float(defval, title?, minval?, maxval?, step?, tooltip?, inline?, group?, confirm?, display?, active?) → input float | Ondalık girdi.
input.bool(defval, title?, tooltip?, inline?, group?, confirm?, display?, active?) → input bool | Onay kutusu.
input.string(defval, title?, options?, tooltip?, inline?, group?, confirm?, display?, active?) → input string | Metin / seçenek listesi.
input.color(defval, title?, tooltip?, inline?, group?, confirm?, display?, active?) → input color | Renk seçici.
input.source(defval, title?, tooltip?, inline?, group?, display?, active?) → series float | Kaynak seri seçici (close, hl2...).
input.symbol(defval, title?, tooltip?, inline?, group?, confirm?, display?, active?) → input string | Sembol seçici.
input.timeframe(defval, title?, options?, tooltip?, inline?, group?, confirm?, display?, active?) → input string | Zaman dilimi seçici.
input.session(defval, title?, options?, tooltip?, inline?, group?, confirm?, display?, active?) → input string | Seans aralığı.
input.time(defval, title?, tooltip?, inline?, group?, confirm?, display?, active?) → input int | Tarih/saat (grafikten seçilebilir).
input.price(defval, title?, tooltip?, inline?, group?, confirm?, display?, active?) → input float | Fiyat (grafikten seçilebilir).
input.text_area(defval, title?, tooltip?, group?, confirm?, display?, active?) → input string | Çok satırlı metin.
input.enum(defval, title?, options?, tooltip?, inline?, group?, confirm?, display?, active?) → input enum | Enum seçici.
request.security(symbol, timeframe, expression, gaps?, lookahead?, ignore_invalid_symbol?, currency?, calc_bars_count?) → series | Başka sembol/zaman diliminden veri ister.
request.security_lower_tf(symbol, timeframe, expression, ignore_invalid_symbol?, currency?, ignore_invalid_timeframe?, calc_bars_count?) → array | Alt zaman dilimi değerlerini dizi olarak döndürür.
request.dividends(ticker, field?, gaps?, lookahead?, ignore_invalid_symbol?, currency?) → series float | Temettü verisi.
request.splits(ticker, field, gaps?, lookahead?, ignore_invalid_symbol?) → series float | Hisse bölünme verisi.
request.earnings(ticker, field?, gaps?, lookahead?, ignore_invalid_symbol?, currency?) → series float | Bilanço verisi.
request.currency_rate(from, to, ignore_invalid_currency?) → series float | Döviz kuru.
str.tostring(value, format?) → string | Metne çevirir.
str.tonumber(string) → float | Sayıya çevirir (geçersizse na).
str.format(formatString, arg0, arg1, ...) → string | {0} {1,number,#.##} kalıplı biçimlendirme.
str.format_time(time, format?, timezone?) → string | Zamanı kalıba göre biçimlendirir.
str.length(string) → int | Uzunluk.
str.contains(source, str) → bool | İçeriyor mu.
str.startswith(source, str) → bool | Bununla mı başlıyor.
str.endswith(source, str) → bool | Bununla mı bitiyor.
str.pos(source, str) → int | İlk konum (yoksa na).
str.substring(source, begin_pos, end_pos?) → string | Alt metin.
str.replace(source, target, replacement, occurrence?) → string | n'inci eşleşmeyi değiştirir.
str.replace_all(source, target, replacement) → string | Tüm eşleşmeleri değiştirir.
str.split(string, separator) → array<string> | Böler.
str.lower(source) → string | Küçük harf.
str.upper(source) → string | Büyük harf.
str.trim(source) → string | Baş/son boşlukları siler.
str.repeat(source, repeat, separator?) → string | Tekrarlar.
str.match(source, regex) → string | Regex eşleşmesi (yoksa na).
color.new(color, transp) → color | Şeffaflıkla (0-100) renk.
color.rgb(red, green, blue, transp?) → color | RGB renk.
color.r(color) → float | Kırmızı bileşen.
color.g(color) → float | Yeşil bileşen.
color.b(color) → float | Mavi bileşen.
color.t(color) → float | Şeffaflık.
color.from_gradient(value, bottom_value, top_value, bottom_color, top_color) → color | Değere göre renk geçişi.
array.new<type>(size?, initial_value?) → array | Yeni dizi.
array.from(arg0, arg1, ...) → array | Değerlerden dizi.
array.size(id) → int | Eleman sayısı.
array.get(id, index) → any | Eleman.
array.set(id, index, value) → void | Elemanı yazar.
array.push(id, value) → void | Sona ekler.
array.pop(id) → any | Sondan çıkarır.
array.unshift(id, value) → void | Başa ekler.
array.shift(id) → any | Baştan çıkarır.
array.insert(id, index, value) → void | Araya ekler.
array.remove(id, index) → any | Siler.
array.clear(id) → void | Boşaltır.
array.first(id) → any | İlk eleman.
array.last(id) → any | Son eleman.
array.slice(id, index_from, index_to) → array | Dilim (kopyasız görünüm).
array.copy(id) → array | Kopya.
array.concat(id1, id2) → array | Birleştirir.
array.reverse(id) → void | Ters çevirir.
array.sort(id, order?) → void | Sıralar.
array.sort_indices(id, order?) → array<int> | Sıralı indeksler.
array.includes(id, value) → bool | İçeriyor mu.
array.indexof(id, value) → int | İlk indeks.
array.lastindexof(id, value) → int | Son indeks.
array.binary_search(id, val) → int | İkili arama.
array.sum(id) → float | Toplam.
array.avg(id) → float | Ortalama.
array.min(id, nth?) → float | En küçük.
array.max(id, nth?) → float | En büyük.
array.median(id) → float | Medyan.
array.stdev(id, biased?) → float | Standart sapma.
array.variance(id, biased?) → float | Varyans.
array.join(id, separator?) → string | Metne birleştirir.
array.fill(id, value, index_from?, index_to?) → void | Doldurur.
array.every(id) → bool | Tümü doğru mu.
array.some(id) → bool | Biri doğru mu.
map.new<keyType, valueType>() → map | Yeni harita.
map.put(id, key, value) → any | Ekler/günceller; eski değeri döndürür.
map.get(id, key) → any | Değer (yoksa na).
map.contains(id, key) → bool | Anahtar var mı.
map.remove(id, key) → any | Siler.
map.size(id) → int | Çift sayısı.
map.keys(id) → array | Anahtarlar (ekleme sırası).
map.values(id) → array | Değerler.
map.clear(id) → void | Boşaltır.
map.copy(id) → map | Kopya.
map.put_all(id, id2) → void | Diğer haritayı ekler.
matrix.new<type>(rows?, columns?, initial_value?) → matrix | Yeni matris.
matrix.get(id, row, column) → any | Eleman.
matrix.set(id, row, column, value) → void | Elemanı yazar.
matrix.rows(id) → int | Satır sayısı.
matrix.columns(id) → int | Sütun sayısı.
matrix.row(id, row) → array | Satır.
matrix.col(id, column) → array | Sütun.
matrix.add_row(id, row?, array_id?) → void | Satır ekler.
matrix.add_col(id, column?, array_id?) → void | Sütun ekler.
matrix.transpose(id) → matrix | Devrik.
matrix.mult(id1, id2) → matrix | Çarpım.
matrix.inv(id) → matrix | Ters.
matrix.det(id) → float | Determinant.
line.new(x1, y1, x2, y2, xloc?, extend?, color?, style?, width?, force_overlay?) → line | Çizgi nesnesi (veya chart.point aşırı yüklemesi).
line.set_xy1(id, x, y) → void | Başlangıç noktası.
line.set_xy2(id, x, y) → void | Bitiş noktası.
line.set_color(id, color) → void | Renk.
line.set_width(id, width) → void | Kalınlık.
line.set_style(id, style) → void | Stil.
line.set_extend(id, extend) → void | Uzatma.
line.get_price(id, x) → float | x barındaki fiyat.
line.delete(id) → void | Siler.
box.new(left, top, right, bottom, border_color?, border_width?, border_style?, extend?, xloc?, bgcolor?, text?, text_size?, text_color?) → box | Kutu nesnesi.
box.set_lefttop(id, left, top) → void | Sol üst.
box.set_rightbottom(id, right, bottom) → void | Sağ alt.
box.set_bgcolor(id, color) → void | Dolgu rengi.
box.delete(id) → void | Siler.
label.new(x, y, text?, xloc?, yloc?, color?, style?, textcolor?, size?, textalign?, tooltip?) → label | Etiket nesnesi.
label.set_xy(id, x, y) → void | Konum.
label.set_text(id, text) → void | Metin.
label.set_color(id, color) → void | Renk.
label.delete(id) → void | Siler.
table.new(position, columns, rows, bgcolor?, frame_color?, frame_width?, border_color?, border_width?) → table | Tablo nesnesi.
table.cell(table_id, column, row, text?, width?, height?, text_color?, text_halign?, text_valign?, text_size?, bgcolor?) → void | Hücre yazar.
polyline.new(points, curved?, closed?, xloc?, line_color?, fill_color?, line_style?, line_width?) → polyline | chart.point dizisinden çoklu çizgi.
linefill.new(line1, line2, color) → linefill | İki çizgi arasını boyar.
chart.point.new(time, index, price) → chart.point | Grafik noktası.
chart.point.from_index(index, price) → chart.point | Bar indeksinden nokta.
chart.point.from_time(time, price) → chart.point | Zamandan nokta.
chart.point.now(price?) → chart.point | Geçerli bardaki nokta.
log.info(message, arg0?, ...) → void | Betik Konsolu'na bilgi yazar.
log.warning(message, arg0?, ...) → void | Betik Konsolu'na uyarı yazar.
log.error(message, arg0?, ...) → void | Betik Konsolu'na hata yazar.
runtime.error(message) → void | Betiği hata ile durdurur.
strategy.entry(id, direction, qty?, limit?, stop?, oca_name?, oca_type?, comment?, alert_message?, disable_alert?) → void | Pozisyona giriş emri.
strategy.order(id, direction, qty?, limit?, stop?, oca_name?, oca_type?, comment?, alert_message?, disable_alert?) → void | Ham emir (pyramiding yok sayılır).
strategy.exit(id, from_entry?, qty?, qty_percent?, profit?, limit?, loss?, stop?, trail_price?, trail_points?, trail_offset?, oca_name?, comment?, alert_message?) → void | Çıkış (TP/SL/trailing) emri.
strategy.close(id, comment?, qty?, qty_percent?, alert_message?, immediately?) → void | Girişi piyasa emriyle kapatır.
strategy.close_all(comment?, alert_message?, immediately?) → void | Tüm pozisyonu kapatır.
strategy.cancel(id) → void | Bekleyen emri iptal eder.
strategy.cancel_all() → void | Tüm bekleyen emirleri iptal eder.
`;

const VARS = `
open → series float | Bar açılış fiyatı.
high → series float | Bar en yüksek fiyatı.
low → series float | Bar en düşük fiyatı.
close → series float | Bar kapanış fiyatı (gerçek zamanlı barda son fiyat).
volume → series float | Bar hacmi.
hl2 → series float | (high + low) / 2.
hlc3 → series float | (high + low + close) / 3.
ohlc4 → series float | (open + high + low + close) / 4.
hlcc4 → series float | (high + low + 2*close) / 4.
time → series int | Bar açılış zamanı (UNIX ms).
time_close → series int | Bar kapanış zamanı (UNIX ms).
timenow → series int | Şu anki zaman (UNIX ms).
bar_index → series int | Bar sırası (ilk bar 0).
last_bar_index → series int | Son barın indeksi.
na → na | Değer yok.
barstate.isfirst → series bool | İlk bar.
barstate.islast → series bool | Son bar.
barstate.isconfirmed → series bool | Bar kapandı.
barstate.isrealtime → series bool | Gerçek zamanlı bar.
barstate.ishistory → series bool | Geçmiş bar.
barstate.isnew → series bool | Barın ilk tik'i.
barstate.islastconfirmedhistory → series bool | Son onaylı geçmiş bar.
syminfo.ticker → simple string | Sembol adı (borsasız).
syminfo.tickerid → simple string | Borsa:sembol.
syminfo.mintick → simple float | En küçük fiyat adımı.
syminfo.currency → simple string | Fiyat para birimi.
syminfo.timezone → simple string | Borsa saat dilimi.
syminfo.type → simple string | Varlık tipi (stock, crypto...).
timeframe.period → simple string | Grafik zaman dilimi ("15", "D").
timeframe.multiplier → simple int | Zaman dilimi çarpanı.
timeframe.isintraday → simple bool | Gün içi mi.
timeframe.isdaily → simple bool | Günlük mü.
timeframe.isweekly → simple bool | Haftalık mı.
timeframe.ismonthly → simple bool | Aylık mı.
ta.obv → series float | Denge hacmi.
ta.accdist → series float | Birikim/dağıtım.
ta.pvt → series float | Fiyat-hacim trendi.
ta.nvi → series float | Negatif hacim endeksi.
ta.pvi → series float | Pozitif hacim endeksi.
ta.wad → series float | Williams birikim/dağıtım.
ta.wvad → series float | Williams değişken birikim/dağıtım.
ta.iii → series float | Gün içi yoğunluk endeksi.
ta.vwap → series float | Seans VWAP (hlc3).
ta.tr → series float | Gerçek aralık.
strategy.position_size → series float | Açık pozisyon büyüklüğü (+uzun, -kısa).
strategy.position_avg_price → series float | Ortalama giriş fiyatı.
strategy.equity → series float | Özsermaye.
strategy.netprofit → series float | Net kâr.
strategy.openprofit → series float | Açık pozisyon kârı.
strategy.closedtrades → series int | Kapanmış işlem sayısı.
strategy.opentrades → series int | Açık işlem sayısı.
strategy.long → const string | Uzun yön.
strategy.short → const string | Kısa yön.
math.pi → const float | π.
math.e → const float | e.
math.phi → const float | Altın oran.
`;

const CONSTS: Array<[string, string[]]> = [
  ['color', ['aqua', 'black', 'blue', 'fuchsia', 'gray', 'green', 'lime', 'maroon', 'navy', 'olive', 'orange', 'purple', 'red', 'silver', 'teal', 'white', 'yellow']],
  ['plot.style', ['line', 'linebr', 'stepline', 'stepline_diamond', 'histogram', 'cross', 'area', 'areabr', 'columns', 'circles']],
  ['shape', ['xcross', 'cross', 'circle', 'triangleup', 'triangledown', 'flag', 'arrowup', 'arrowdown', 'labelup', 'labeldown', 'square', 'diamond']],
  ['location', ['abovebar', 'belowbar', 'top', 'bottom', 'absolute']],
  ['size', ['auto', 'tiny', 'small', 'normal', 'large', 'huge']],
  ['hline.style', ['solid', 'dotted', 'dashed']],
  ['line.style', ['solid', 'dotted', 'dashed', 'arrow_left', 'arrow_right', 'arrow_both']],
  ['label.style', ['label_up', 'label_down', 'label_left', 'label_right', 'label_center', 'none', 'circle', 'square', 'diamond', 'triangleup', 'triangledown', 'arrowup', 'arrowdown', 'xcross', 'cross', 'flag']],
  ['extend', ['none', 'left', 'right', 'both']],
  ['xloc', ['bar_index', 'bar_time']],
  ['yloc', ['price', 'abovebar', 'belowbar']],
  ['position', ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right']],
  ['text', ['align_left', 'align_center', 'align_right', 'align_top', 'align_bottom']],
  ['barmerge', ['gaps_on', 'gaps_off', 'lookahead_on', 'lookahead_off']],
  ['display', ['all', 'none', 'pane', 'data_window', 'price_scale', 'status_line']],
  ['format', ['inherit', 'price', 'volume', 'percent', 'mintick']],
  ['scale', ['right', 'left', 'none']],
  ['order', ['ascending', 'descending']],
  ['alert', ['freq_all', 'freq_once_per_bar', 'freq_once_per_bar_close']],
  ['dayofweek', ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']],
  ['strategy.direction', ['all', 'long', 'short']],
  ['strategy', ['fixed', 'cash', 'percent_of_equity']],
  ['strategy.commission', ['percent', 'cash_per_contract', 'cash_per_order']],
];

export const SCRIPT_KEYWORDS = [
  'if', 'else', 'for', 'to', 'by', 'in', 'while', 'break', 'continue', 'switch', 'var', 'varip', 'and', 'or', 'not',
  'true', 'false', 'import', 'export', 'as', 'method', 'type', 'enum', 'const', 'input', 'simple', 'series',
];

export const SCRIPT_TYPES = ['int', 'float', 'bool', 'string', 'color', 'line', 'label', 'box', 'table', 'linefill', 'polyline', 'array', 'matrix', 'map', 'chart.point'];

const KEYWORD_DOCS: Record<string, string> = {
  var: 'Değişkeni yalnızca ilk barda başlatır; değer barlar arasında korunur.',
  varip: 'Gerçek zamanlı barın tik\'leri arasında bile korunan değişken (geri alma yok).',
  if: 'Koşullu blok. İfade olarak değer döndürebilir.',
  for: '`for i = başlangıç to bitiş [by adım]` sayaçlı döngü.',
  while: '`while koşul` döngüsü.',
  switch: 'Çok dallı seçim; ifade olarak değer döndürebilir.',
  type: 'Kullanıcı tanımlı tip (UDT): alanlar ve varsayılanlar.',
  method: 'Bir tipe nokta sözdizimiyle çağrılabilen fonksiyon.',
  enum: 'Sabit üyeli numaralandırma tipi.',
  import: '`import kullanıcı/kütüphane/sürüm as takma_ad` kütüphane içe aktarma.',
  export: 'Kütüphane üyesini dışa açar.',
};

function parseParams(s: string): RefParam[] {
  const inner = s.trim();
  if (!inner) return [];
  return inner.split(',').map((p) => {
    const t = p.trim();
    const optional = t.endsWith('?');
    return { name: optional ? t.slice(0, -1) : t, optional };
  });
}

function build(): RefEntry[] {
  const out: RefEntry[] = [];
  for (const raw of FUNCS.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([\w.]+)(<[^>]*>)?\((.*)\)\s*→\s*([^|]+)\|\s*(.*)$/.exec(line);
    if (!m) throw new Error(`reference: bozuk satır: ${line}`);
    const [, name, generic = '', params, ret, doc] = m;
    const ps = parseParams(params);
    out.push({
      name,
      kind: 'function',
      params: ps,
      returns: ret.trim(),
      doc: doc.trim(),
      signature: `${name}${generic}(${ps.map((p) => p.name + (p.optional ? '?' : '')).join(', ')}) → ${ret.trim()}`,
    });
  }
  for (const raw of VARS.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([\w.]+)\s*→\s*([^|]+)\|\s*(.*)$/.exec(line);
    if (!m) throw new Error(`reference: bozuk satır: ${line}`);
    const [, name, ret, doc] = m;
    out.push({ name, kind: 'variable', params: [], returns: ret.trim(), doc: doc.trim(), signature: `${name}: ${ret.trim()}` });
  }
  for (const [ns, members] of CONSTS) {
    for (const mem of members) {
      const name = `${ns}.${mem}`;
      const ret = ns === 'color' ? 'const color' : 'const string';
      out.push({ name, kind: 'constant', params: [], returns: ret, doc: `${ns} sabiti.`, signature: `${name}: ${ret}` });
    }
  }
  for (const k of SCRIPT_KEYWORDS) {
    out.push({ name: k, kind: 'keyword', params: [], returns: '', doc: KEYWORD_DOCS[k] ?? 'Anahtar sözcük.', signature: k });
  }
  for (const t of SCRIPT_TYPES) {
    if (!out.some((e) => e.name === t)) out.push({ name: t, kind: 'type', params: [], returns: '', doc: `${t} tipi.`, signature: t });
  }
  return out;
}

export const SCRIPT_REFERENCE: RefEntry[] = build();

const BY_NAME = new Map<string, RefEntry>();
for (const e of SCRIPT_REFERENCE) if (!BY_NAME.has(e.name)) BY_NAME.set(e.name, e);

/** Tam adla arama (`ta.sma`, `close`, `color.red`). Fonksiyon önceliklidir (`time` hem fonksiyon hem değişken). */
export function lookupRef(name: string): RefEntry | undefined {
  return BY_NAME.get(name);
}

/** Bir isim alanının doğrudan üyeleri: `ta` → sma, ema...; `chart` → point. Tekrarsız. */
export function namespaceMembers(ns: string): Array<{ label: string; entry?: RefEntry }> {
  const prefix = ns + '.';
  const seen = new Map<string, RefEntry | undefined>();
  for (const e of SCRIPT_REFERENCE) {
    if (!e.name.startsWith(prefix)) continue;
    const rest = e.name.slice(prefix.length);
    const dot = rest.indexOf('.');
    const label = dot < 0 ? rest : rest.slice(0, dot);
    if (dot < 0) {
      if (!seen.has(label) || !seen.get(label)) seen.set(label, e);
    } else if (!seen.has(label)) seen.set(label, undefined);
  }
  return [...seen].map(([label, entry]) => ({ label, entry }));
}

/** Kök isim alanları (ta, math, str, ...). */
export function rootNamespaces(): string[] {
  const s = new Set<string>();
  for (const e of SCRIPT_REFERENCE) {
    const dot = e.name.indexOf('.');
    if (dot > 0) s.add(e.name.slice(0, dot));
  }
  return [...s].sort();
}

/** Referans paneli araması: ad önce, sonra açıklama. */
export function searchRef(q: string, limit = 200): RefEntry[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return SCRIPT_REFERENCE.filter((e) => e.kind === 'function' || e.kind === 'variable').slice(0, limit);
  const byName = SCRIPT_REFERENCE.filter((e) => e.name.toLowerCase().includes(needle));
  const byDoc = SCRIPT_REFERENCE.filter((e) => !e.name.toLowerCase().includes(needle) && e.doc.toLowerCase().includes(needle));
  byName.sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)) || a.name.length - b.name.length);
  return [...byName, ...byDoc].slice(0, limit);
}
