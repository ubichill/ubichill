{{/*
Expand the name of the chart.
*/}}
{{- define "ubichill.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ubichill.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "ubichill.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ubichill.labels" -}}
helm.sh/chart: {{ include "ubichill.chart" . }}
{{ include "ubichill.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ubichill.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ubichill.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use for backend
*/}}
{{- define "ubichill.serviceAccountName.backend" -}}
{{- printf "%s-backend" (include "ubichill.fullname" .) }}
{{- end }}

{{/*
Create the name of the service account to use for frontend
*/}}
{{- define "ubichill.serviceAccountName.frontend" -}}
{{- printf "%s-frontend" (include "ubichill.fullname" .) }}
{{- end }}

{{/*
Backend image
*/}}
{{- define "ubichill.backend.image" -}}
{{- if .Values.global.imageRegistry }}
{{- printf "%s/%s:%s" .Values.global.imageRegistry .Values.backend.image.repository (.Values.backend.image.tag | default .Chart.AppVersion) }}
{{- else }}
{{- printf "%s:%s" .Values.backend.image.repository (.Values.backend.image.tag | default .Chart.AppVersion) }}
{{- end }}
{{- end }}

{{/*
Instance (Go) image
*/}}
{{- define "ubichill.instance.image" -}}
{{- if .Values.global.imageRegistry }}
{{- printf "%s/%s:%s" .Values.global.imageRegistry .Values.instanceRuntime.image.repository (.Values.instanceRuntime.image.tag | default .Chart.AppVersion) }}
{{- else }}
{{- printf "%s:%s" .Values.instanceRuntime.image.repository (.Values.instanceRuntime.image.tag | default .Chart.AppVersion) }}
{{- end }}
{{- end }}

{{/*
Instance (Go) が受け付けるブラウザ Origin。未指定なら https://<global.domain>。
*/}}
{{- define "ubichill.instance.origins" -}}
{{- if .Values.instanceRuntime.origins }}
{{- join "," .Values.instanceRuntime.origins }}
{{- else if .Values.global.domain }}
{{- printf "https://%s" .Values.global.domain }}
{{- end }}
{{- end }}

{{/*
同梱の Redis（Valkey）の名前の元。Bitnami の subchart と同じ規則にして、Service・Secret の名前を移行の前後で変えない。
*/}}
{{- define "ubichill.redis.fullname" -}}
{{- if .Values.redis.fullnameOverride }}
{{- .Values.redis.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default "redis" .Values.redis.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "ubichill.redis.port" -}}
{{- dig "service" "ports" "redis" 6379 .Values.redis.master }}
{{- end }}

{{/*
同梱の Redis の REDIS_URL。パスワードは URL に入れず REDIS_PASSWORD で渡す。
*/}}
{{- define "ubichill.redis.url" -}}
{{- printf "redis://%s-master:%v" (include "ubichill.redis.fullname" .) (include "ubichill.redis.port" .) }}
{{- end }}

{{- define "ubichill.redis.selectorLabels" -}}
{{ include "ubichill.selectorLabels" . }}
component: redis
{{- end }}

{{/*
同梱の Redis のパスワードの Secret。auth.existingSecret があればそれ、無ければ chart が作る <fullname>（キー redis-password）。
*/}}
{{- define "ubichill.redis.secretName" -}}
{{- if .Values.redis.auth.existingSecret }}
{{- tpl .Values.redis.auth.existingSecret . }}
{{- else }}
{{- include "ubichill.redis.fullname" . }}
{{- end }}
{{- end }}

{{- define "ubichill.redis.secretKey" -}}
{{- if .Values.redis.auth.existingSecret }}
{{- .Values.redis.auth.existingSecretPasswordKey | default "redis-password" }}
{{- else }}
{{- print "redis-password" }}
{{- end }}
{{- end }}

{{/*
イメージの参照。引数は dict（image: {repository, tag, digest}, key: エラーに出す values の key）。
版を固定する（latest・空のタグは描画で失敗）。Bitnami は版付きのタグを消したので、残った values で引かないよう拒む。
*/}}
{{- define "ubichill.redis.imageRef" -}}
{{- $image := .image }}
{{- if contains "bitnami" $image.repository }}
{{- fail (printf "%s.repository に Bitnami のイメージ（%s）は使えません。chart は Valkey と oliver006/redis_exporter を使うので、values から %s を消してください" .key $image.repository .key) }}
{{- end }}
{{- if $image.digest }}
{{- if not (hasPrefix "sha256:" $image.digest) }}
{{- fail (printf "%s.digest は sha256:<hex> の形です（%s）" .key $image.digest) }}
{{- end }}
{{- if $image.tag }}
{{- printf "%s:%s@%s" $image.repository $image.tag $image.digest }}
{{- else }}
{{- printf "%s@%s" $image.repository $image.digest }}
{{- end }}
{{- else }}
{{- if or (not $image.tag) (eq (toString $image.tag) "latest") }}
{{- fail (printf "%s.tag は版を固定してください（latest・空は不可。digest を指定するならタグは空でも可）" .key) }}
{{- end }}
{{- printf "%s:%s" $image.repository (toString $image.tag) }}
{{- end }}
{{- end }}

{{/*
Valkey の maxmemory。redis.config.maxmemory が空なら resources.limits.memory の 75%。
maxmemory はデータだけを数え、AOF の書き直しの fork（copy-on-write）・Pub/Sub の出力バッファ・断片化は含まないので、上限いっぱいにすると OOMKill される。
*/}}
{{- define "ubichill.redis.maxmemory" -}}
{{- $explicit := dig "config" "maxmemory" "" .Values.redis | toString }}
{{- if $explicit }}
{{- $explicit }}
{{- else }}
{{- $limit := dig "resources" "limits" "memory" "" .Values.redis.master | toString }}
{{- if regexMatch `^[0-9]+(\.[0-9]+)?Mi$` $limit }}
{{- printf "%dmb" (int (floor (mulf (float64 (trimSuffix "Mi" $limit)) 0.75))) }}
{{- else if regexMatch `^[0-9]+(\.[0-9]+)?Gi$` $limit }}
{{- printf "%dmb" (int (floor (mulf (float64 (trimSuffix "Gi" $limit)) 768))) }}
{{- else }}
{{- fail (printf "redis.config.maxmemory を指定するか、redis.master.resources.limits.memory を Mi か Gi で指定してください（%s）" $limit) }}
{{- end }}
{{- end }}
{{- end }}

{{/*
valkey.conf。パスワードは Secret から起動の引数で渡す（ConfigMap に入れない）。
認証なし（auth.enabled: false）でも Pod の外から繋げるよう protected-mode は切る（NetworkPolicy で絞る）。
*/}}
{{- define "ubichill.redis.config" -}}
{{- $cfg := .Values.redis.config | default dict -}}
port 6379
bind * -::*
protected-mode no
dir /data
appendonly yes
appendfsync {{ $cfg.appendfsync | default "everysec" }}
save ""
maxmemory {{ include "ubichill.redis.maxmemory" . }}
maxmemory-policy {{ $cfg.maxmemoryPolicy | default "noeviction" }}
{{- with $cfg.extra }}
{{ . }}
{{- end }}
{{- end }}

{{/*
backend と instance に渡す Redis の env（REDIS_URL・REDIS_PASSWORD）。両方が同じ接続先を見るよう、ここだけで組み立てる。
- redis.enabled: 同梱の Valkey。パスワードは chart の Secret（auth.existingSecret があればそちら）
- redis.external.url: 外部の Redis。パスワードは redis.external.existingSecret があれば参照する
- どちらも無ければ何も出さない（Redis なしで動く）
*/}}
{{- define "ubichill.redis.env" -}}
{{- $ext := .Values.redis.external | default dict }}
{{- if and .Values.redis.enabled $ext.url }}
{{- fail "redis.enabled と redis.external.url は同時に指定できません。外部の Redis を使うときは redis.enabled: false にしてください" }}
{{- end }}
{{- if .Values.redis.enabled }}
- name: REDIS_URL
  value: {{ include "ubichill.redis.url" . | quote }}
{{- if .Values.redis.auth.enabled }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "ubichill.redis.secretName" . }}
      key: {{ include "ubichill.redis.secretKey" . }}
{{- end }}
{{- else if $ext.url }}
- name: REDIS_URL
  value: {{ $ext.url | quote }}
{{- if $ext.existingSecret }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ tpl $ext.existingSecret . }}
      key: {{ $ext.existingSecretPasswordKey | default "redis-password" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Frontend image
*/}}
{{- define "ubichill.frontend.image" -}}
{{- if .Values.global.imageRegistry }}
{{- printf "%s/%s:%s" .Values.global.imageRegistry .Values.frontend.image.repository (.Values.frontend.image.tag | default .Chart.AppVersion) }}
{{- else }}
{{- printf "%s:%s" .Values.frontend.image.repository (.Values.frontend.image.tag | default .Chart.AppVersion) }}
{{- end }}
{{- end }}