# Pen Package

シンプルなペンオブジェクトを提供するパッケージです。

## 機能

- ドラッグ&ドロップで移動可能
- ロック機能（他のユーザーが操作中は移動不可）
- カラーカスタマイズ

## 使用方法

このパッケージは Ubichill のコアパッケージとして組み込まれています。
ルーム定義で以下のように参照できます:

```yaml
apiVersion: ubichill.com/v1alpha1
kind: Room
metadata:
  name: my-room
spec:
  dependencies:
    - name: pen
      source:
        type: repository
        path: "packages/pen"
  
  initialEntities:
    - kind: "pen:pen"
      transform:
        x: 400
        y: 300
        z: 1
        scale: 1
        rotation: -45
      data:
        color: "#228BE6"
```

## Kind 定義

### `pen:pen`

| プロパティ | 型 | デフォルト | 説明 |
|-----------|------|---------|------|
| `color` | string | `#228BE6` | ペンの色 |
| `isHeld` | boolean | `false` | ドラッグ中かどうか |
