## freee IT管理 CLI (GraphQL)

YAML/JSON を desired state として **Workflow を plan/apply** します。

### 前提

- Node.js: **>= 24**（`package.json` の engines 準拠）
- npm: **>= 10**

### セットアップ

```bash
npm i
```

`npm i` 時に `schema.json` を自動生成します（`.env` に `FREEE_IT_GRAPHQL_ENDPOINT` / `FREEE_IT_TOKEN` がある場合）。

### 環境変数

- `FREEE_IT_GRAPHQL_ENDPOINT`: GraphQL endpoint URL
- `FREEE_IT_TOKEN`: Bearer token
- `FREEE_IT_SCHEMA_PATH`: enum 検証に使う `schema.json` パス（省略可、デフォルト `./schema.json`）
- `FREEE_IT_HTTP_TIMEOUT_MS`: request timeout（省略可、デフォルト 30000）
- `FREEE_IT_SCHEMA_FORCE`: `1` で `schema.json` を強制再生成（postinstall 用）

### 使い方

- schema.json 生成（introspection）

```bash
npm run dev -- schema fetch -o schema.json
```

- export（現状→YAML）

```bash
npm run dev -- export -o exported.yaml
```

- export で内部IDをそのまま出したい（名前変換しない）

```bash
npm run dev -- export --ids -o exported.yaml
```

- export 時に名前変換用カタログを再取得したい（`.freee-it/catalog.json` を更新）

```bash
npm run dev -- export --refresh-catalog -o exported.yaml
```

- 名前->内部ID解決用カタログ操作

```bash
# カタログを再取得してローカルキャッシュに保存
npm run dev -- catalog pull

# アプリ一覧（name/id）
npm run dev -- catalog applications

# 部署一覧（fullName/databaseId）
npm run dev -- catalog departments

# アプリ内グループ一覧（name/databaseId）
npm run dev -- catalog application-groups -a "Slack"
```

- plan（差分表示）

```bash
npm run dev -- plan -f automation.example.yaml
```

- 順序差分を無視して plan（reorder を出さない）
```bash
npm run dev -- plan -f automation.example.yaml --ignore-order
```

- apply（適用）

```bash
npm run dev -- apply -f automation.example.yaml
```

- 順序差分を無視して apply（reorder をしない）
```bash
npm run dev -- apply -f automation.example.yaml --ignore-order
```

### IaC repo からの実行（バージョン固定 / pin）

破壊的変更に巻き込まれないように、IaC 側では **必ずバージョン固定**で実行するのを推奨します。

- git tag / commit SHA で固定（npm publish 前でも使える）

```bash
# tag 固定の例（例: v0.1.1）
npx -y github:<owner>/<repo>#v0.1.1 plan -f spec.yaml

# SHA 固定の例
npx -y github:<owner>/<repo>#<commit_sha> apply -f spec.yaml --prune
```

- npm で固定（**公開している場合のみ**）

このリポジトリは現状 `package.json` が `private: true` なので、npm 経由の利用は想定していません（公開する場合は `private` を外して publish）。

```bash
npx -y <package-name>@0.1.1 plan -f spec.yaml
```

### 注意

- Workflow の同定は **id があれば id、なければ name の完全一致**です（同名が複数あるとエラーにします）。
- `argumentKind` は schema 上 `UpdateWorkflowInput` に無く **更新できない扱い**にしています（違う場合はエラー）。
- `tasks` の同定は `(applicationId, actionName)` の組で行います。
- `--prune` を付けると spec に無い task を `deleteWorkflowTask` します。

