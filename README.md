# Catalog electronic – SMMMFN „Amiral Ion Murgescu”

Catalog electronic pentru Școala Militară de Maiștri Militari a Forțelor Navale „Amiral Ion Murgescu”.

- Stadiul proiectului și instrucțiuni de rulare: [`PROJECT_STATUS.md`](PROJECT_STATUS.md)
- Arhitectura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Securitate: [`SECURITY.md`](SECURITY.md)
- Formatul importului de orar: [`docs/ORAR_IMPORT.md`](docs/ORAR_IMPORT.md)

```bash
cp .env.example .env && npm install
npm run db:migrate && npm run db:seed && npm run creeaza-admin
npm run build && npm start      # sau: npm run dev
npm test                        # 134 de teste automate (necesită PostgreSQL local)
```
