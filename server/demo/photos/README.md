# Photos for the demonstration data

`npm run db:demo` attaches these photos to its posts.  A missing photo leaves its post without one, and the script
lists the missing names at the end.  Any accepted extension works (`.jpg`, `.png`, `.webp`, `.heic`).

| File name | Post | What to photograph | Taken by |
| --- | --- | --- | --- |
| `airpods.jpg` | White AirPods Pro in a black case (found, library) | AirPods in a black case on a desk | |
| `idcard.jpg` | LAU student ID card (found, sensitive) | A card the size of an ID with the name, photo and number covered | |
| `wallet.jpg` | Brown leather wallet (drop-off desk) | A brown wallet, closed | |
| `charger.jpg` | MacBook charger, 67 W (drop-off desk) | A white laptop charger with its cable | |
| `umbrella.jpg` | Grey umbrella with a wooden handle (returned) | A folded umbrella on a bench | |
| `bottle.jpg` | Blue water bottle (lost) | A dark blue bottle with stickers | |
| `keys.jpg` | Car keys with a red keychain (lost, Byblos) | Keys on a red keychain | |
| `backpack.jpg` | Black backpack (drop-off desk, Byblos) | A black backpack, closed | |
| `notebook.jpg` | Engineering notebook, green cover (found) | A green spiral notebook, closed | |
| `laptop.jpg` | QR tag: Silver MacBook Air | A closed silver laptop | |

Rules for every photo:

- Landscape (4:3), the item centred on a plain background, in daylight.
- No faces, no real names, numbers, cards or documents: cover them before taking the photo.
- JPEG, PNG, WebP or HEIC, under 10 MB (the app compresses it to 1 MB).

Each member adds two photos from their own GitHub account and writes their name in the table, in a pull request
linked to issue #18.
