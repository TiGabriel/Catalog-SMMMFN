# Import orar – format șablon Excel (versiunea 1)

Șablonul se descarcă din aplicație: **Administrare → Orar (import) → Descarcă șablonul**. Șablonul conține și foile de referință **Clase**, **Materii**, **Profesori** și **Ore**, generate din datele curente.

## Foaia „Orar”
Un rând = o oră de curs. Primul rând conține antetele. Ordinea coloanelor nu contează. Majusculele și diacriticele din antete sunt ignorate.

| Coloană | Obligatoriu | Valori acceptate | Exemplu |
|---|---|---|---|
| **Clasa** | da | codul unei clase din anul școlar selectat | `112` |
| **Ziua** | da | `Luni`, `Marți`, `Miercuri`, `Joi`, `Vineri` (sau `1`–`5`; `Sâmbătă`/`Duminică` generează un avertisment) | `Luni` |
| **Ora** | da | numărul orei din programul orar (`1`, `2`, …) sau ora de început (`08:00`) | `1` |
| **Materie** | da | codul materiei (recomandat) sau denumirea exactă; nu se acceptă „Purtare” | `MAT` |
| **Profesor** | da | numele de utilizator al unui profesor **activ** | `prof.popescu` |
| **Sala** | nu | text liber (max. 80 caractere) | `A12` |
| **Săptămâna** | nu | `Toate` (implicit), `Impară`, `Pară` (după numărul săptămânii ISO) | `Toate` |
| **Grupa** | nu | text liber, pentru clasele împărțite pe grupe | `1` |

## Parametrii aleși în aplicație (nu în fișier)
- **Anul școlar**: clasele se caută în acest an. Anii încheiați nu pot fi modificați.
- **Valabil din săptămâna**: data aleasă este normalizată la ziua de **luni** a săptămânii respective și trebuie să fie în anul școlar.
- **Până în săptămâna** (opțional): este normalizată la **duminica** săptămânii. Dacă lipsește, orarul este valabil până la înlocuirea lui.
- **Denumire**: ex. „Orar semestrul I”.

## Validări (erori – nimic nu se importă dacă există o eroare)
- lipsesc coloane obligatorii sau câmpuri obligatorii;
- clasă, materie, profesor, zi, oră sau valoare pentru „Săptămâna” necunoscute;
- profesor inactiv;
- **celule cu formule**, celule cu erori, valori prea lungi;
- **conflicte**: aceeași clasă în același interval (în afara grupelor diferite); același profesor la două clase în același interval (ținând cont de săptămânile pare/impare);
- fișier care nu este `.xlsx`, fișier gol, peste 2 MB, cu macro-uri (VBA/ActiveX), arhivă cu conținut necomprimat excesiv sau peste 3000 de rânduri.

Fiecare problemă este raportată cu **numărul rândului** și **coloana**.

## Avertismente (importul este permis)
- profesorul nu are o repartizare activă pentru materia și clasa respectivă;
- aceeași sală folosită simultan de clase diferite;
- ore programate sâmbăta sau duminica.

## Publicare și versiuni
1. Un fișier valid creează o **versiune în lucru**, care nu este vizibilă utilizatorilor.
2. **Previzualizarea** arată orarul pe clase și diferențele față de versiunea publicată pe care o înlocuiește.
3. La **publicare**, versiunea devine activă începând cu săptămâna sa de început. Versiunile anterioare nu se modifică și nu se șterg.
4. Pentru orice săptămână se afișează versiunea publicată cu **cea mai recentă dată de început** care acoperă săptămâna. La date egale, câștigă publicarea cea mai recentă.
5. **Arhivarea** unei versiuni publicate readuce automat versiunea anterioară. O versiune arhivată poate fi **restaurată** (republicată).
6. Toate fișierele încărcate sunt păstrate (conținut + amprentă SHA-256), iar fiecare import, publicare și arhivare apare în jurnalul de audit.
