# Photos for the demonstration data

`npm run db:demo` attaches these photos to its posts.  A missing photo leaves its post without one, and the script
lists the missing names at the end.  Any accepted extension works (`.jpg`, `.png`, `.webp`, `.heic`).

| File name | Post | What to photograph |
| --- | --- | --- |
| `earbuds.jpg` | Wireless earbuds in a silver case (found, library) | An earbuds case on a desk |
| `idcard.jpg` | LAU student ID card (found, sensitive) | A card the size of an ID with the name, photo and number covered |
| `wallet.jpg` | Black leather wallet (drop-off desk) | A black wallet, closed |
| `charger.jpg` | Phone charger with a USB-C cable (drop-off desk) | A black phone charger with its cable |
| `umbrella.jpg` | Grey folding umbrella with a loop handle (returned) | A folded umbrella |
| `bottle.jpg` | White water bottle with a grey lid (lost) | A water bottle on a table |
| `keys.jpg` | Car key with a silver race-car keychain (lost, Byblos) | A car key on a keychain |
| `backpack.jpg` | Black backpack (drop-off desk, Byblos) | A black backpack, closed |
| `notebook.jpg` | University notebook, grey cover (found) | A spiral notebook, closed |
| `laptop.jpg` | QR tag: Silver MacBook Air | A closed silver laptop |

Rules for every photo:

- Landscape (4:3), the item centred on a plain background, in daylight.
- No faces, no real names, numbers, cards or documents: cover them before taking the photo.
- JPEG, PNG, WebP or HEIC, under 10 MB (the app compresses it to 1 MB).

Each member adds two photos from their own GitHub account, in a pull request linked to issue #18; the history of
this folder shows who added each one.

