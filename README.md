# Drátkovaná poezie

Samostatně spustitelný web s veřejnou galerií, kontaktním formulářem a administrací. Administrátor může spravovat kategorie, výrobky, fotografie, profilovou sekci a doručené zprávy.

## Přihlášení

- Uživatelské jméno: `Admin`
- Heslo: `Havirov123`

Před veřejným nasazením je doporučeno změnit heslo pomocí proměnné `ADMIN_PASSWORD`.

## Lokální spuštění

```bash
npm install
npm run dev
```

- Web: `http://localhost:5173`
- Administrace: `http://localhost:5173/admin`
- API: `http://localhost:3001/api`

## Produkční spuštění

```bash
npm install
npm run build
npm start
```

Produkční web poběží na `http://localhost:3001`.

## Data a fotografie

- Obsah webu se ukládá do `data/db.json`.
- Nahrané fotografie se ukládají do složky `uploads/`.
- Pro hosting s persistentním diskem nastavte `DATA_DIR` a `UPLOAD_DIR` na připojené úložiště.

## Proměnné prostředí

Zkopírujte `.env.example` do `.env` nebo nastavte hodnoty přímo v hostingu. Server soubor `.env` automaticky načte:

- `PORT`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`
- `MAX_UPLOAD_MB`
- `DATA_DIR` (volitelné)
- `UPLOAD_DIR` (volitelné)

## Kontrola projektu

```bash
npm run check
```

Příkaz provede TypeScript kontrolu, produkční sestavení a smoke test hlavních funkcí.
