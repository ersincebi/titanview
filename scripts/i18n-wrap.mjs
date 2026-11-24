#!/usr/bin/env node
// Faz 30 — i18n codemod: ui/*.tsx içindeki görünür Türkçe JSX metinlerini ve
// title/placeholder/aria-label/label özniteliklerini `tt('…')` ile sarar.
// `tt` Türkçe metni anahtar alıp EN modunda `state/i18n_en.ts` sözlüğünden çevirir.
// Kullanım: node scripts/i18n-wrap.mjs [--write] [--list out.json] dosya...
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const args = process.argv.slice(2);
const write = args.includes('--write');
const literals = args.includes('--literals');
const listIdx = args.indexOf('--list');
const listOut = listIdx >= 0 ? args[listIdx + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && !(listIdx >= 0 && i === listIdx + 1));

const TR_CHARS = /[çğıöşüÇĞİÖŞÜ]/;
// ASCII yazılan yaygın Türkçe sözcükler (ç/ş içermeyenler)
const TR_WORDS =
  /\b(ve|ile|bir|bu|yok|var|Son|Sembol|Sinyal|Hacim|Tamam|Kaydet|Sil|Ekle|Yeni|Kapat|Ayarlar|Durum|Hepsi|Liste|Listem|Piyasa|Fiyat|Alarm|Alarmlar|Emir|Emirler|Pozisyon|Pozisyonlar|Hesap|Haber|Haberler|Takvim|Notlar|Seans|Zaman|Tarih|Grafik|Panel|Kanal|Trend|Yatay|Dikey|Metin|Ortalama|Ort|Hedef|Zarar|Kar|Komisyon|Bakiye|Miktar|Adet|Tip|Tipi|Renk|Stil|Kalite|Kaynak|Uzunluk|Periyot|Dolum|Bekleyen|Aktif|Pasif|Kapali|Aralik|Sonuc|Sonra|Once|Bekle|Yenile|Getir|Ara|Filtre|Sutun|Kolon|Sayfa|Dosya|Kopya|Kopyala|Yapistir|Gizle|Kilitle|Kilidi|Kaldir|Taban|Tavan|Yukari|Asagi|Al|Sat|Alim|Uzun|Kisa|Kapanis|Acilis|Yuksek|Dusuk|Degisim|Deg|Gun|Hafta|Ay|Yil|Saat|Dakika|Saniye|Tablo|Analiz|Oran|Spread|Sepet|Endeks|Hisse|Kripto|Altin|Doviz|Temettu|Bilanco|Gelir|Gider|Nakit|Akis|Veri|Yukle|Yukleniyor|Hata|Uyari|Bilgi|Onay|Iptal|Gonder|Duzenle|Durdur|Baslat|Devam|Klonla|Tumu|Hicbiri|ekle|kaldir|favorilere|listeye|yok|tum)\b/i;

function looksTurkish(s) {
  if (/^var\(--/.test(s)) return false;
  return TR_CHARS.test(s) || TR_WORDS.test(s);
}
const decode = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, '\u00a0');

const ATTRS = new Set(['title', 'placeholder', 'aria-label', 'label', 'alt']);
const collected = new Set();
const templates = [];
const tfEdits = [];
const unsafe = [];
let curSf = null, curFile = '';
const where = (n) => `${curFile}:${curSf.getLineAndCharacterOfPosition(n.getStart(curSf)).line + 1}: ${n.getText(curSf).slice(0, 90)}`;

function insideLangTernary(node) {
  // en() ? 'A' : 'B'  /  lang() === 'en' ? … — zaten yerelleştirilmiş, atla
  for (let p = node.parent; p && !ts.isJsxElement(p) && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isConditionalExpression(p)) {
      const c = p.condition.getText();
      if (/\ben\(\)|lang\(\)|isEn|\.lang\b/.test(c)) return true;
    }
    if (ts.isCallExpression(p) && /^(t|tt)$/.test(p.expression.getText())) return true;
  }
  return false;
}

function processFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  curSf = sf; curFile = file;
  const edits = []; // {start,end,text}

  function visit(node) {
    if (ts.isJsxText(node)) {
      const raw = node.getFullText(sf);
      const trimmed = decode(raw.replace(/\s+/g, ' ').trim());
      if (trimmed && /[A-Za-zçğıöşüÇĞİÖŞÜ]/.test(trimmed) && looksTurkish(trimmed)) {
        const lead = /^[ \t]*\S/.test(raw) && /^[ \t]+/.test(raw) ? "{' '}" : '';
        const trail = /\S[ \t]+$/.test(raw) ? "{' '}" : '';
        const startPad = raw.match(/^\s*/)[0];
        const endPad = raw.match(/\s*$/)[0];
        const keepStart = startPad.includes('\n') ? startPad : '';
        const keepEnd = endPad.includes('\n') ? endPad : '';
        edits.push({
          start: node.getFullStart(),
          end: node.getEnd(),
          text: `${keepStart}${lead}{tt(${JSON.stringify(trimmed)})}${trail}${keepEnd}`,
        });
        collected.add(trimmed);
      }
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (ATTRS.has(name)) {
        const init = node.initializer;
        if (ts.isStringLiteral(init) && looksTurkish(init.text)) {
          edits.push({ start: init.getStart(sf), end: init.getEnd(), text: `{tt(${JSON.stringify(init.text)})}` });
          collected.add(init.text);
        }
      }
    } else if (
      ts.isStringLiteral(node) &&
      node.parent &&
      ts.isJsxExpression(node.parent) &&
      looksTurkish(node.text) &&
      !insideLangTernary(node)
    ) {
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tt(${JSON.stringify(node.text)})` });
      collected.add(node.text);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.parent &&
      ts.isConditionalExpression(node.parent) &&
      looksTurkish(node.text) &&
      !insideLangTernary(node) &&
      isInJsx(node)
    ) {
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tt(${JSON.stringify(node.text)})` });
      collected.add(node.text);
    }
    else if (literals && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && TR_CHARS.test(node.text) && literalOk(node)) {
      edits.push({ start: node.getStart(sf), end: node.getEnd(), text: `tt(${JSON.stringify(node.text)})` });
      collected.add(node.text);
    } else if (literals && ts.isTemplateExpression(node) && TR_CHARS.test(node.getText(sf)) && literalOk(node)) {
      templates.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${node.getText(sf).slice(0, 140)}`);
      // `a${x}b${y}c` → tf("a{0}b{1}c", x, y); iç içe Türkçe şablonlar ayrıca sarılır (önce iç)
      let key = node.head.text;
      const exprs = [];
      node.templateSpans.forEach((sp, i) => {
        key += `{${i}}` + sp.literal.text;
        exprs.push(sp.expression);
      });
      if (!/\n/.test(key)) {
        tfEdits.push({ node, key, exprs });
        collected.add(key);
      }
    }
    ts.forEachChild(node, visit);
  }
  function literalOk(node) {
    const p = node.parent;
    if (/\n|\/\/@version|^\s*\/\//.test(node.text ?? node.getText(sf))) return false;
    if (!p) return false;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return false;
    if (ts.isPropertyAssignment(p) && p.name === node) return false;
    if (ts.isElementAccessExpression(p)) return false;
    if (ts.isBinaryExpression(p) && /^(===|!==|==|!=|in)$/.test(p.operatorToken.getText(sf))) return false;
    if (ts.isCaseClause(p)) return false;
    if (ts.isLiteralTypeNode(p)) return false;
    if (ts.isJsxAttribute(p)) return false; // id/class/value öznitelikleri
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText(sf);
      if (/^(tt|t|console\.\w+|localStorage\.\w+|fetch|require|describe|it|test|expect|querySelector\w*|document\.\w+|new Error|setUi|setStore|setSettings|setSettingsTab|setTool|setWorkbenchTab|openDrawerTab|on|addEventListener|getElementById)$/.test(callee)) return false;
      if (/\.(includes|startsWith|endsWith|indexOf|split|replace|replaceAll|match|test|get|set|has|delete|setItem|getItem|querySelector|closest|setAttribute|getAttribute|add|remove|toggle)$/.test(callee)) return false;
    }
    if (ts.isNewExpression(p) && /Error|RegExp|URL/.test(p.expression.getText(sf))) return false;
    if (ts.isThrowStatement(p)) return false;
    // zaten dil ternary'si içinde
    if (insideLangTernary(node)) return false;
    // Yalnız görüntü bağlamları: güvenli olmayanlar elle incelenmek üzere listelenir
    const DISPLAY = /^(label|title|desc|description|hint|tooltip|message|msg|text|name|heading|placeholder|subtitle|caption|help|note|summary|detail|emptyMsg|confirm|header|unit)$/;
    const KEYISH = /^(category|group|kind|id|key|value|type|tag|tags|field|op|mode|market|cat|section)$/;
    if (ts.isPropertyAssignment(p)) {
      const pname = p.name.getText(sf).replace(/['"]/g, '');
      if (KEYISH.test(pname)) { unsafe.push(where(node)); return false; }
      if (DISPLAY.test(pname)) return true;
      const obj = p.parent;
      if (ts.isObjectLiteralExpression(obj) && obj.properties.every((q) => ts.isPropertyAssignment(q) && (ts.isStringLiteral(q.initializer) || ts.isNoSubstitutionTemplateLiteral(q.initializer)) && !TR_CHARS.test(q.name.getText(sf)))) return true;
      unsafe.push(where(node));
      return false;
    }
    if (ts.isArrayLiteralExpression(p)) {
      const els = p.elements;
      if (els.length >= 2 && els.indexOf(node) > 0 && (ts.isStringLiteral(els[0]) || ts.isNumericLiteral(els[0])) && !TR_CHARS.test(els[0].getText(sf))) return true;
      if (els.length >= 2 && ts.isArrayLiteralExpression(p.parent) && els.some((e) => ts.isArrowFunction(e) || ts.isFunctionExpression(e))) return true;
      if (els.length >= 2 && els.length <= 4 && ts.isArrayLiteralExpression(p.parent) && els.every((e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && els.indexOf(node) > 0) return true;
      unsafe.push(where(node));
      return false;
    }
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText(sf);
      if (/(^|\.)(toast|showToast|notify|pushToast|cell|item|row|stat|kv|metric|confirm|alert|prompt|setStatus|setError|setMsg|setMessage|setNotice|statCell|section|heading)$/i.test(callee)) return true;
      unsafe.push(where(node));
      return false;
    }
    if (ts.isConditionalExpression(p) || ts.isBinaryExpression(p) && p.operatorToken.getText(sf) === '??' || ts.isReturnStatement(p) || ts.isParenthesizedExpression(p) || ts.isJsxExpression(p)) return true;
    if (ts.isBinaryExpression(p) && p.operatorToken.getText(sf) === '+') return true;
    unsafe.push(where(node));
    return false;
    // en: { ... } / labelEn / titleEn alanları içindeki TR karşılıklar zaten çiftli
    if (ts.isPropertyAssignment(p) && /^(tr|labelTr|titleTr|descTr|nameTr|en|labelEn|titleEn)$/.test(p.name.getText(sf))) return false;
    return true;
  }
  function isInJsx(node) {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isJsxExpression(p)) return true;
      if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
    }
    return false;
  }
  visit(sf);
  for (const t of tfEdits.splice(0).reverse()) {
    const start = t.node.getStart(sf), end = t.node.getEnd();
    // iç düzenlemeleri ifadelerin metnine uygula
    const exprTexts = t.exprs.map((e) => {
      const es = e.getStart(sf), ee = e.getEnd();
      let txt = src.slice(es, ee);
      const inner = edits.filter((x) => x.start >= es && x.end <= ee).sort((a, b) => b.start - a.start);
      for (const x of inner) txt = txt.slice(0, x.start - es) + x.text + txt.slice(x.end - es);
      return txt;
    });
    for (let i = edits.length - 1; i >= 0; i--) if (edits[i].start >= start && edits[i].end <= end) edits.splice(i, 1);
    edits.push({ start, end, text: `tfmt(${JSON.stringify(t.key)}${exprTexts.map((x) => ', ' + x).join('')})` });
  }
  if (!edits.length) return 0;
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const needTf = /\btfmt\(/.test(out) && !/import \{[^}]*\btfmt\b[^}]*\} from '[./]*(state\/)?i18n'/.test(out);
  if (needTf) {
    const rel0 = path.relative(path.dirname(file), path.resolve('frontend/src/state/i18n')).replace(/\\/g, '/');
    const spec0 = rel0.startsWith('.') ? rel0 : `./${rel0}`;
    out = `import { tfmt } from '${spec0}';\n` + out;
  }
  if (!/import \{[^}]*\btt\b[^}]*\} from '[./]*(state\/)?i18n'/.test(out)) {
    const rel = path.relative(path.dirname(file), path.resolve('frontend/src/state/i18n')).replace(/\\/g, '/');
    const spec = rel.startsWith('.') ? rel : `./${rel}`;
    const re = new RegExp(`import \\{([^}]*)\\} from '${spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}';`);
    if (re.test(out)) out = out.replace(re, (m, g) => `import {${g.trimEnd()}, tt } from '${spec}';`);
    else out = `import { tt } from '${spec}';\n` + out;
  }
  if (write) fs.writeFileSync(file, out);
  return edits.length;
}

let total = 0;
for (const f of files) {
  const n = processFile(f);
  if (n) console.log(`${n}\t${f}`);
  total += n;
}
console.log(`toplam ${total} düzenleme, ${collected.size} benzersiz metin`);
if (listOut) fs.writeFileSync(listOut, JSON.stringify([...collected].sort(), null, 1));
if (args.includes('--templates')) console.log(templates.join('\n'));
if (args.includes('--unsafe')) console.log(unsafe.join('\n'));
