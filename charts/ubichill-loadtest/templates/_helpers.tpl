{{- define "ubichill-loadtest.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "ubichill-loadtest.fullname" -}}
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

{{- define "ubichill-loadtest.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "ubichill-loadtest.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "ubichill-loadtest.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ubichill-loadtest.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
値の検査。本番の Go の Service 名（ubichill-instance）そのものを向いた URL は断る。
dev（ubichill-dev-instance）やプレビューの名前は通す。
*/}}
{{- define "ubichill-loadtest.validate" -}}
{{- $url := .Values.target.instanceUrl -}}
{{- if not (regexMatch "^https?://" $url) -}}
{{- fail "target.instanceUrl は http(s) の URL（例: http://ubichill-dev-instance:3002）" -}}
{{- end -}}
{{- if regexMatch "^https?://ubichill-instance([.:/]|$)" $url -}}
{{- fail "target.instanceUrl が本番の Service（ubichill-instance）を向いています。負荷試験は dev 環境でだけ走らせる" -}}
{{- end -}}
{{- if not .Values.target.adminTokenSecret.name -}}
{{- fail "target.adminTokenSecret.name（INSTANCE_ADMIN_TOKEN を持つ Secret）が必要" -}}
{{- end -}}
{{- if lt (int .Values.workers) 1 -}}
{{- fail "workers は 1 以上" -}}
{{- end -}}
{{- end }}
