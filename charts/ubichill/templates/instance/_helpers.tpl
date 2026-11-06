{{/*
Go の duration（h・m・s の組み合わせ）を秒にする。terminationGracePeriodSeconds を drainTimeout から決めるため。
*/}}
{{- define "ubichill.durationSeconds" -}}
{{- $d := toString . -}}
{{- if not (regexMatch "^([0-9]+(h|m|s))+$" $d) -}}
{{- fail (printf "duration は h・m・s の組み合わせで書きます（例: 24h, 1h30m, 15s）: %q" $d) -}}
{{- end -}}
{{- $total := 0 -}}
{{- range regexFindAll "[0-9]+(h|m|s)" $d -1 -}}
{{- $n := int (trimSuffix "h" (trimSuffix "m" (trimSuffix "s" .))) -}}
{{- if hasSuffix "h" . -}}{{- $total = add $total (mul $n 3600) -}}
{{- else if hasSuffix "m" . -}}{{- $total = add $total (mul $n 60) -}}
{{- else -}}{{- $total = add $total $n -}}{{- end -}}
{{- end -}}
{{- $total -}}
{{- end -}}

{{- define "ubichill.serviceAccountName.instance" -}}
{{- printf "%s-instance" (include "ubichill.fullname" .) -}}
{{- end -}}
