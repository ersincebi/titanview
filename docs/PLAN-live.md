# Canlı akış planı (atomik güncelleme)

## Teşhis
| Belirti | Kök neden |
|---|---|
| PEGASUS son mum 14:45, XRP 20:30 | Veri doğru; eksen UTC. BIST son 15dk barı 17:45 TR = 14:45 UTC, seans kapalı. XRP 7/24. |
| Betik projeksiyonu mumların gerisinde | `handleLiveTick` mumu günceller ama betiği yeniden çalıştırmaz. |
| Analiz/ekranlar kendiliğinden yenilenmiyor | `loadAnalysis` yalnızca sembol değişince çağrılıyor. |
| Sekme uyuyunca grafik geride | WS kopunca/sekme gizlenince kaçan mumlar doldurulmuyor. |

## Mimari
1. `chart/timezone.ts` — eksen + crosshair yerel saat (Europe/Istanbul vb.), UTC değil.
2. `state/liveFeed.ts` — besleme sağlığı (canlı/gecikmeli/seans kapalı/kopuk), kuyruk onarımı (`healTail`), watchdog.
3. `store.ts` — tick sonrası betiği kısıtlı yeniden çalıştır (`scheduleScript`): yeni barda anında, aynı barda ≤1/sn.
4. `analysisStore.ts` — sessiz (flicker'sız) yenileme: 30 sn döngü, yeni barda, sekme/ağ dönüşünde.
5. `state/lab.ts` + `ui/Lab.tsx` — her tick'te yeniden hesaplanan laboratuvar paneli.

## Metot imzaları
```ts
// chart/timezone.ts
export function resolveTimeZone(pref?: string): string
export function formatAxisTime(unixSec: number, kind: 'year'|'month'|'day'|'time', tz?: string): string
export function formatCrosshairTime(unixSec: number, tz?: string): string

// state/liveFeed.ts
export type FeedState = 'live' | 'delayed' | 'closed' | 'reconnecting' | 'offline'
export interface FeedHealth { state: FeedState; lastTickAt: number; lastBarTime: number; ageSec: number }
export const feed: Accessor<FeedHealth>
export function classifyFeed(i: { online: boolean; wsConnected: boolean; market?: string; interval: Timeframe; lastBarTime: number; lastTickAt: number; now: number }): FeedState
export function markTick(candle: Candle): void
export function mergeTail(list: Candle[], fresh: Candle[]): { list: Candle[]; appended: Candle[]; changed: boolean }
export function healTail(): Promise<void>
export function startFeedWatchdog(): () => void

// store.ts
export function scheduleScript(newBar: boolean): void

// analysisStore.ts
export const analysisUpdatedAt: Accessor<number>
export function refreshAnalysisSoft(symbol?: string): Promise<void>
export function startAnalysisLive(): () => void

// state/lab.ts
export interface LabStats { ... }
export function computeLab(c: Candle[], interval: Timeframe): LabStats | null
```
