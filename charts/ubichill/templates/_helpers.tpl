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
redis subchart の fullname（bitnami common.names.fullname と同じ規則。Service・Secret の名前の元）。
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

{{/*
subchart の REDIS_URL。パスワードは URL に入れず REDIS_PASSWORD で渡す。
*/}}
{{- define "ubichill.redis.url" -}}
{{- printf "redis://%s-master:%v" (include "ubichill.redis.fullname" .) (.Values.redis.master.service.ports.redis | default 6379) }}
{{- end }}

{{/*
backend と instance に渡す Redis の env（REDIS_URL・REDIS_PASSWORD）。両方が同じ接続先を見るよう、ここだけで組み立てる。
- redis.enabled: subchart。パスワードは subchart の Secret（auth.existingSecret があればそちら）
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
      {{- if .Values.redis.auth.existingSecret }}
      name: {{ tpl .Values.redis.auth.existingSecret . }}
      key: {{ .Values.redis.auth.existingSecretPasswordKey | default "redis-password" }}
      {{- else }}
      name: {{ include "ubichill.redis.fullname" . }}
      key: redis-password
      {{- end }}
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