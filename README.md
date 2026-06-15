# quick-pick 🎱

동행복권 로또 6/45 **AI 번호 추천 + 주간 자동 수동구매** 도구입니다.

> Playwright 대신 **HTTP API** 방식을 사용합니다. 브라우저 없이 가볍게 동작하고, AI가 추천한 번호를 **수동(genType=1)** 으로 구매합니다.

## 기능

- 📦 **로컬 캐시** — 1~최신회차 `data/draws.json` 저장, 이후 신규 회차만 동기화
- 📊 최근 N회 당첨 내역 분석 (캐시에서 읽음)
- 🤖 OpenAI 기반 AI 번호 추천 (API 키 없으면 통계 기반 자동 대체)
- 🛒 동행복권 수동 번호 자동 구매 (1~5게임)
- ⏰ node-cron 주간 스케줄러 (기본: **매주 월요일 10:00** — 토요일은 온라인 판매 없음)
- 🖥️ **웹 대시보드** — 구매 내역·실행 로그 확인 (`npm run web`)

## 사전 준비

1. [동행복권](https://www.dhlottery.co.kr/main) 회원가입
2. **예치금 충전** (1게임 = 1,000원)
3. [건전 구매 서약서](https://www.dhlottery.co.kr/hpns/sdnsCamPainView) 1년 주기 동의

## 설치

```bash
git clone https://github.com/YOOHEESU97/quick-pick.git
cd quick-pick
npm install
cp .env.example .env
# .env 파일에 계정 정보 입력
npm run build

# 최초 1회: 전체 당첨 내역 캐시 (1~최신회차, 약 1~2초)
npm run sync
```

## 사용법

```bash
# 캐시 동기화 (최초 전체 / 이후 신규 회차만) + 구매 정산
npm run sync

# 전체 캐시 재다운로드
npm run sync -- --full

# 구매 당첨 정산만 (sync 시 자동 실행됨)
npm run settle
npm run settle -- -r 1226

# 로그인만 테스트 (구매 없음)
npm run login-test

# AI 번호 추천 (캐시만 사용, API 없음)
npm run recommend

# AI 추천 번호로 즉시 구매
npm run buy

# 당첨번호 확인
npm run check

# 주간 자동 구매 스케줄러 (백그라운드 실행)
npm run schedule

# 웹 대시보드 (구매 내역 + 로그)
npm run web
# → http://127.0.0.1:3847
```

개발 모드 (빌드 없이):

```bash
npm run dev recommend
npm run dev buy
```

## 환경변수 (.env)

| 변수 | 설명 | 기본값 |
|------|------|--------|
| `DHLOTTERY_ID` | 동행복권 아이디 | (필수) |
| `DHLOTTERY_PASSWORD` | 동행복권 비밀번호 | (필수) |
| `OPENAI_API_KEY` | OpenAI API 키 | (선택) |
| `OPENAI_MODEL` | AI 모델 | `gpt-4o-mini` |
| `TICKET_COUNT` | 구매 게임 수 (1~5) | `1` |
| `HISTORY_WEEKS` | 분석할 과거 회차 수 | `52` |
| `CRON_SCHEDULE` | cron 표현식 (KST) | `0 10 * * 1` (월 10:00) |
| `CACHE_PATH` | 캐시 파일 경로 | `data/draws.json` |
| `SUPABASE_URL` | Supabase 프로젝트 URL | (선택) |
| `SUPABASE_SERVICE_ROLE_KEY` | 서버용 service_role 키 | (선택) |
| `STORAGE_BACKEND` | `auto` / `local` / `supabase` / `both` | `auto` |

## Supabase (로그·구매 기록)

VM을 새로 깔아도 **구매·실행 로그**를 클라우드에 남기려면 Supabase 무료 프로젝트를 쓰면 됩니다. (당첨 캐시 `draws.json` 은 여전히 로컬 — `npm run sync`)

### 1. 프로젝트 생성

1. [supabase.com](https://supabase.com) → New project
2. **SQL Editor** → `supabase/schema.sql` 내용 붙여넣기 → Run

### 2. API 키 (.env)

Project Settings → **API**:

```env
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...   # Secret / service_role
STORAGE_BACKEND=auto
DRAWS_STORAGE=both
```

- **service_role / Secret** 은 서버(스케줄러/CLI)에만 두세요.
- `STORAGE_BACKEND` — 로그·구매 기록
- `DRAWS_STORAGE=both` — 당첨 회차 Supabase + `data/draws.json` (Oracle VM 권장)

**이미 예전 schema만 실행했다면** SQL Editor에서 `supabase/migrations/002_lotto_draws_settlement.sql` 추가 실행.

### 3. 빌드 후 사용

```bash
npm run build
npm run sync   # 당첨 DB + 신규 회차 정산
npm run buy
npm run web    # 순손익·당첨금 표시
```

동행복권 **아이디/비밀번호는 Supabase에 넣지 않습니다.**

## 당첨 정산 · 손익

1. `sync` — 당첨 API에서 회차별 **1~5등 1인당 당첨금** 저장 (`lotto_draws`)
2. 추첨이 끝난 회차에 대해 **내 구매** 등수·금액 계산 → `purchases`에 `prize_total` 저장
3. 대시보드 — **총 구매 / 총 당첨 / 순손익** (세금·실지급과 다를 수 있음)

| 명령 | 설명 |
|------|------|
| `npm run sync` | 당첨 동기화 + 자동 정산 |
| `npm run settle` | 정산만 다시 실행 |

## 캐시 · API 호출 정책 (차단 방지)

| 명령 | 당첨 API (`dhlottery.co.kr`) |
|------|------------------------------|
| `npm run sync` | 호출 (전체 1회 또는 신규 회차만 1~2회) |
| `npm run recommend` | **캐시만** (API 없음) |
| `npm run buy` | 캐시 **12시간 이내**면 API 생략, 만료 시만 sync |
| 로그인/구매 | `www` / `ol` 도메인만 (당첨 API와 별도) |

- `API_MIN_DELAY_MS=2000` — 당첨 API·로그인 요청 사이 최소 2초
- `CACHE_MAX_AGE_HOURS=12` — 이 안이면 buy 시 당첨 API 재조회 안 함

1. **`npm run sync`** — 최초 1회 필수 (1~최신회차 저장)
2. **토요일 20:45 추첨 직후** — 가능하면 `npm run sync` (신규 당첨 반영). 안 해도 **월요일 자동 구매** 시 캐시 만료(12h)면 자동 sync
3. **`recommend` / 분석** — 항상 `data/draws.json` 만 읽음

## 주간 타임라인 (기본 설정)

| 시점 | 동작 |
|------|------|
| **토 20:00** | 해당 회차 온라인 구매 마감 |
| **토 20:45** | 추첨 → 당첨 번호 확정 |
| **토~일** | 새 회차 온라인 판매 없음 (구매 불가) |
| **월 10:00** | `npm run schedule` → AI 추천 + 수동 구매 (다음 토 추첨 회차) |

`schedule` / `buy` 한 번에 하는 일: (1) 캐시 필요 시만 당첨 API 1~2회 (2) 캐시로 번호 추천 (3) 동행복권 로그인·구매 (요청 간 2초 간격).

## 대시보드

`buy`, `sync`, `recommend` 실행 시 로그·구매 기록이 저장됩니다. (Supabase 설정 시 클라우드, 아니면 `data/logs.json` · `data/purchases.json`)

```bash
npm run web
```

브라우저에서 http://127.0.0.1:3847 — 구매 번호·실행 로그·최신 회차 요약 (30초 자동 새로고침)

## AI 추천 방식

1. **OpenAI** (`OPENAI_API_KEY` 설정 시): 최근 당첨 통계(빈도, 미출현, 홀짝 비율 등)를 분석해 AI가 번호 추천
2. **통계 기반** (API 키 없을 때): 출현 빈도 + 미출현(오버듀) + 최근 핫/콜드 넘버 가중치로 추천

## macOS 자동 실행 (launchd)

매주 **월요일** 자동 구매를 원하면 `~/Library/LaunchAgents/com.quickpick.lotto.plist` 생성:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.quickpick.lotto</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/yooheesu/Documents/quick-pick/dist/index.js</string>
    <string>buy</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>2</integer>
    <key>Hour</key>
    <integer>10</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>WorkingDirectory</key>
  <string>/Users/yooheesu/Documents/quick-pick</string>
  <key>StandardOutPath</key>
  <string>/Users/yooheesu/Documents/quick-pick/data/buy.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/yooheesu/Documents/quick-pick/data/buy-error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.quickpick.lotto.plist
```

## HTTP API 방식 — 괜찮은가?

**개인 주 1회 자동 구매** 용도로는 현실적으로 충분합니다. Playwright보다 가볍고, 이미 핫스팟/로그인·구매·sync가 되었다면 구조는 맞습니다.

| 구분 | 내용 |
|------|------|
| **장점** | 브라우저 불필요, VM·cron에 적합, 당첨 API 호출 최소(캐시·rate-limit) |
| **리스크** | 비공식 엔드포인트 → 사이트 개편 시 `history.ts` / `dhlottery.ts` 수정 필요 |
| **리스크** | IP·망 차단 → Oracle VM 또는 핫스팟, `API_MIN_DELAY_MS` 유지 |
| **리스크** | 이용약관·과도한 호출 — **주 1회 buy + 토요일 sync** 수준 유지 |
| **권장** | 계정·비밀번호는 `.env`만, Supabase는 service_role 서버 전용 |

동행복권 **공식 Open API가 아닙니다.** 막히면 로그(`data/logs.json`)와 `npm run login-test`로 먼저 확인하세요.

## 네트워크 차단 (timeout / 로그인 실패)

집 Wi‑Fi에서는 안 되고 **폰에서는 동행복권이 열리면**, PC의 IP/망이 제한된 경우입니다.

| 해결 | 용도 |
|------|------|
| **폰 핫스팟**으로 Mac 연결 | 지금 Mac에서 `buy` / `login-test` |
| **Oracle Cloud VM**에서 실행 | 주간 자동 구매 (VM은 다른 IP) |
| VPN | 핫스팟이 어려울 때 |

```bash
# 망 확인
curl -I --max-time 10 https://www.dhlottery.co.kr/
```

`.env`에 `HTTP_TIMEOUT_MS=90000` 을 두면 느린 응답에도 여유가 있습니다.

## 주의사항

- 동행복권 온라인 구매는 **주당 최대 5게임** 제한
- 추첨: 매주 토요일 20:45 (구매 마감: 토요일 20:00) — **자동 구매는 월요일** (`CRON_SCHEDULE`)
- 비공식 API 사용 — 사이트 변경 시 업데이트 필요
- 로또는 오락 목적이며, AI/통계 추천이 당첨을 보장하지 않습니다

## 라이선스

MIT
