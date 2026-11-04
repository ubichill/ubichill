{{- define "ubichill-loadtest.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- /* TestRun の名前に -browser を足しても 63 文字に収まるよう 50 文字で切る */}}
{{- define "ubichill-loadtest.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 50 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 50 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 50 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "ubichill-loadtest.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "ubichill-loadtest.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
ubichill.com/loadtest-testid: {{ .Values.testid | quote }}
{{- end }}

{{- define "ubichill-loadtest.backendUrl" -}}
{{- if eq .Values.target.via "public" }}
{{- .Values.target.origin | trimSuffix "/" }}
{{- else }}
{{- default (printf "http://%s-backend:3001" .Values.target.release) .Values.target.backendUrl | trimSuffix "/" }}
{{- end }}
{{- end }}

{{- define "ubichill-loadtest.instanceUrl" -}}
{{- if ne .Values.target.via "public" }}
{{- default (printf "http://%s-instance:3002" .Values.target.release) .Values.target.instanceUrl | trimSuffix "/" }}
{{- end }}
{{- end }}

{{/*
値の検査。本番（release・namespace の ubichill、ubichill.com、ubichill-backend / ubichill-instance の Service）を向いた値は断る。
dev（ubichill-dev-*）やプレビューの名前は通す。script（config.ts）でも同じ検査をする。
*/}}
{{- define "ubichill-loadtest.validate" -}}
{{- $v := .Values -}}
{{- if not (regexMatch "^[A-Za-z0-9_.-]{1,63}$" (toString $v.testid)) -}}
{{- fail "testid（走りの名前。英数字・-_. の 63 文字まで）が必要。例: --set testid=smoke-$(date +%m%d-%H%M)" -}}
{{- end -}}
{{- if not (has $v.target.via (list "cluster" "public")) -}}
{{- fail "target.via は cluster か public" -}}
{{- end -}}
{{- if or (eq .Release.Namespace "ubichill") (eq $v.target.release "ubichill") -}}
{{- fail "本番（namespace・release の ubichill）には走らせない。負荷試験は dev 環境（-n ubichill-dev）でだけ" -}}
{{- end -}}
{{- if regexMatch "^https?://(www\\.)?ubichill\\.com([:/]|$)" $v.target.origin -}}
{{- fail "target.origin が本番（ubichill.com）を向いています。負荷試験は dev 環境でだけ走らせる" -}}
{{- end -}}
{{- range $url := list (include "ubichill-loadtest.backendUrl" .) (include "ubichill-loadtest.instanceUrl" .) -}}
{{- if regexMatch "^https?://ubichill-(backend|instance|frontend)([.:/]|$)" $url -}}
{{- fail (printf "%s が本番の Service を向いています。負荷試験は dev 環境でだけ走らせる" $url) -}}
{{- end -}}
{{- end -}}
{{- if lt (int $v.parallelism) 1 -}}
{{- fail "parallelism は 1 以上" -}}
{{- end -}}
{{- if or (lt (int $v.scenario.rooms) 1) (lt (int $v.scenario.usersPerRoom) 1) -}}
{{- fail "scenario.rooms・scenario.usersPerRoom は 1 以上" -}}
{{- end -}}
{{- if ne (mod (int $v.scenario.rooms) (int $v.parallelism)) 0 -}}
{{- fail (printf "scenario.rooms（%v）は parallelism（%v）で割り切れること（同じ部屋の人を同じ runner に置く）" $v.scenario.rooms $v.parallelism) -}}
{{- end -}}
{{- if lt (int $v.scenario.rampSeconds) 1 -}}
{{- fail "scenario.rampSeconds は 1 以上" -}}
{{- end -}}
{{- end }}

{{/* runner の env。script は LT_*（config.ts）を読み、k6 の出力は K6_* で決める */}}
{{- define "ubichill-loadtest.env" -}}
{{- $v := .root.Values -}}
{{- $s := $v.scenario -}}
- name: LT_SCENARIO
  value: {{ .scenario | quote }}
- name: LT_TESTID
  value: {{ $v.testid | quote }}
- name: LT_ORIGIN
  value: {{ $v.target.origin | trimSuffix "/" | quote }}
- name: LT_API_BASE
  value: {{ include "ubichill-loadtest.backendUrl" .root | quote }}
- name: LT_WS_BASE
  value: {{ include "ubichill-loadtest.instanceUrl" .root | quote }}
- name: LT_WORLD
  value: {{ $v.target.worldId | quote }}
- name: LT_ROOMS
  value: {{ $s.rooms | toString | quote }}
- name: LT_USERS_PER_ROOM
  value: {{ $s.usersPerRoom | toString | quote }}
- name: LT_MAX_USERS_PER_ROOM
  value: {{ $s.maxUsersPerRoom | toString | quote }}
- name: LT_CURSOR_HZ
  value: {{ $s.cursorHz | toString | quote }}
- name: LT_ACTIVE_RATIO
  value: {{ $s.activeRatio | toString | quote }}
- name: LT_PATCH_INTERVAL_SECONDS
  value: {{ $s.patchIntervalSeconds | toString | quote }}
- name: LT_CURSOR_BATCH
  value: {{ $s.cursorBatch | toString | quote }}
- name: LT_RAMP_SECONDS
  value: {{ $s.rampSeconds | toString | quote }}
- name: LT_HOLD_SECONDS
  value: {{ $s.holdSeconds | toString | quote }}
- name: LT_ACCOUNT_OFFSET
  value: {{ $v.accounts.offset | toString | quote }}
- name: LT_ACCOUNT_PASSWORD
  value: {{ $v.accounts.password | quote }}
- name: LT_BROWSER_VUS
  value: {{ $v.browser.vus | toString | quote }}
- name: LT_BROWSER_START_SECONDS
  value: {{ ternary $s.rampSeconds $v.browser.startSeconds (eq (toString $v.browser.startSeconds) "") | toString | quote }}
- name: LT_BROWSER_DURATION_SECONDS
  value: {{ ternary $s.holdSeconds $v.browser.durationSeconds (eq (toString $v.browser.durationSeconds) "") | toString | quote }}
- name: LT_BROWSER_PAUSE_SECONDS
  value: {{ $v.browser.pauseSeconds | toString | quote }}
- name: K6_NO_USAGE_REPORT
  value: "true"
{{- with $v.output.prometheus }}
{{- if .enabled }}
- name: K6_PROMETHEUS_RW_SERVER_URL
  value: {{ .serverUrl | quote }}
- name: K6_PROMETHEUS_RW_TREND_STATS
  value: {{ .trendStats | quote }}
- name: K6_PROMETHEUS_RW_TREND_AS_NATIVE_HISTOGRAM
  value: {{ .nativeHistogram | toString | quote }}
- name: K6_PROMETHEUS_RW_PUSH_INTERVAL
  value: {{ .pushInterval | quote }}
{{- /* 終わった系列に stale を送り、Grafana に試験のあとの横線を描かせない */}}
- name: K6_PROMETHEUS_RW_STALE_MARKERS
  value: "true"
{{- end }}
{{- end }}
{{- end }}

{{- /*
  testid は CLI の --tag でも付ける。k6-operator が --tag instance_id=… --tag testrun_name=… を付け、k6 は CLI の tags で
  script の options.tags をまるごと置き換えるので、script 側だけだと testid が指標から消える
*/}}
{{- define "ubichill-loadtest.args" -}}
- --tag
- testid={{ .Values.testid }}
{{- if .Values.output.prometheus.enabled }}
- --out
- experimental-prometheus-rw
{{- end -}}
{{- end }}

{{/* --set で渡した "true" は bool になるので文字列に戻す（nodeSelector の値は文字列） */}}
{{- define "ubichill-loadtest.nodeSelector" -}}
{{- $out := dict -}}
{{- range $key, $value := . }}
{{- $_ := set $out $key (toString $value) -}}
{{- end -}}
{{- toYaml $out -}}
{{- end }}
