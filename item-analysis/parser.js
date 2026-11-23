/* ItemBloom CSV normalization - deterministic, offline, no dependencies.
 * Provider-specific schemas can be added as verified real exports become available.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ItemBloomParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_BYTES = 15 * 1024 * 1024;
  const MAX_ROWS = 20000;
  const MAX_COLUMNS = 1200;
  const ANSWER_RE = /^(?:[A-J]|T|F|TRUE|FALSE|(?:10|[0-9]))$/i;
  const ID_HEADER = /^(?:roster\s*(?:no\.?|number|id)?|roll\s*(?:no\.?|number)?|student\s*(?:id|no\.?|number)|zipgrade\s*id|learner\s*(?:id|no\.?|number)|registration\s*(?:no\.?|number)|id|no\.?)$/i;
  const clean = x => String(x == null ? '' : x).trim().replace(/\s+/g, ' ');
  const norm = x => clean(x).replace(/[\uFEFF]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function parseCSV(text,delimiter){
    if(typeof text!=='string'||!text.trim())throw new Error('The file is empty.');
    const shared=globalThis.ItemBloomCSV||(typeof require==='function'?require('../csv.js'):null);
    if(!shared)throw new Error('Local CSV parser is unavailable. Reopen the application.');
    const rows=[];const collect=row=>{if(row.some(x=>clean(x)))rows.push(row);if(rows.length>MAX_ROWS)throw new Error('CSV has too many rows (limit: 20,000).');};
    const reader=delimiter?shared.csvRows(collect,{delimiter,maxColumns:MAX_COLUMNS}):shared.autoRows(collect,{maxColumns:MAX_COLUMNS});
    reader.feed(text);reader.finish();
    if(rows.length<2)throw new Error('CSV needs a header and at least one learner row.');
    return {rows,delimiter:delimiter||reader.delimiter};
  }
  function questionNumber(header) {
    const s = norm(header);
    if (!s || /\b(?:correct|score|points?|mark|percent|key|weight|mapping|tag|tagged)\b/.test(s)) return null;
    const patterns = [
      /^(?:q|question|item|response|answer|choice|option)\s*0*(\d+)\s*(?:response|answer|choice|option|selected|selection|marked)?$/,
      /^0*(\d+)\s*(?:response|answer|choice|option)$/,
      /^0*(\d+)$/,
      /^q\s*0*(\d+)\s*options?$/
    ];
    for (const re of patterns) { const m = s.match(re); if (m && Number(m[1]) >= 1 && Number(m[1]) <= 500) return Number(m[1]); }
    return null;
  }
  function keyToken(raw) {
    const s = clean(raw).toUpperCase();
    if (!s) return [];
    // Multiple accepted single-choice alternatives. Never infer alternatives from an individual response.
    const parts = s.split(/\s*(?:\||\/|;|\bor\b|,)\s*/).filter(Boolean);
    if (parts.length === 1 && /^[A-J]{2,10}$/.test(parts[0]) && new Set(parts[0]).size === parts[0].length) return [...parts[0]];
    if (parts.length > 10 || !parts.every(p => ANSWER_RE.test(p))) return null;
    return [...new Set(parts.map(p => p === 'TRUE' ? 'T' : p === 'FALSE' ? 'F' : p))];
  }
  function responseToken(raw) {
    const s = clean(raw).toUpperCase();
    if (!s || /^(?:UNANSWERED|BLANK|NO RESPONSE|NO ANSWER|N\/A|NA|-)$/i.test(s)) return {value:'',valid:true};
    if (s === 'TRUE') return {value:'T',valid:true};
    if (s === 'FALSE') return {value:'F',valid:true};
    if (ANSWER_RE.test(s)) return {value:s,valid:true};
    // ZipGrade can record two or more shaded bubbles, e.g. BC or CD.
    // Preserve the evidence; in single-choice mode it earns no credit.
    const joined=s.replace(/[\s,;|/+&]+/g,'');
    if (/^[A-J]{2,10}$/.test(joined) && new Set(joined).size===joined.length) return {value:[...joined].sort().join(''),valid:true,multiple:true};
    return {value:clean(raw),valid:false};
  }
  // ZipGrade's real Full Data CSV stores each item as four sibling columns:
  // StuN (raw learner mark), PriKeyN (official answer), PointsN (earned),
  // MarkN (C/X). These are NOT four competing question-answer columns.
  function zipGradeFullColumns(headers) {
    const groups = new Map();
    headers.forEach((raw, col) => {
      const m = clean(raw).match(/^(Stu|PriKey|Points|Mark)\s*0*(\d+)$/i);
      if (!m) return;
      const n = Number(m[2]);
      if (!Number.isInteger(n) || n < 1 || n > 500) return;
      if (!groups.has(n)) groups.set(n, {});
      const field = {stu:'stu',prikey:'key',points:'points',mark:'mark'}[m[1].toLowerCase()];
      const entry = groups.get(n);
      if (entry[field] !== undefined) throw new Error(`ZipGrade has two ${m[1]} columns for item ${n}.`);
      entry[field] = col;
    });
    if (!groups.size || !groups.has(1) || !groups.get(1).hasOwnProperty('stu') ||
        !groups.get(1).hasOwnProperty('key')) return null;
    const numbers = [...groups.keys()].sort((a,b)=>a-b);
    if (numbers.some((n,i)=>n!==i+1)) throw new Error('ZipGrade item numbers are missing or out of sequence.');
    for (const n of numbers) {
      const fields = groups.get(n);
      if (!['stu','key','points','mark'].every(t=>fields[t]!==undefined)) {
        throw new Error(`ZipGrade item ${n} is missing a Stu, PriKey, Points or Mark column.`);
      }
    }
    return numbers.map(n=>groups.get(n));
  }
  function extractZipGradeFull(rows, filename, headerIndex, blocks) {
    const headers = rows[headerIndex];
    const normalized = headers.map(norm);
    const column = (key) => normalized.indexOf(norm(key));
    const firstCol = column('FirstName'), lastCol = column('LastName');
    const studentCol = column('StudentID'), customCol = column('CustomID');
    const earnedCol = column('Earned Points');
    const warnings = [], learners = [], seenRoster = new Set();
    let invalid=0, blank=0, multi=0, nameless=0, anonymousRoster=0, skipped=0, sourceScoreDiff=0;
    const allKeys = blocks.map(()=>new Set());
    for (let ri=headerIndex+1; ri<rows.length; ri++) {
      const row=rows[ri];
      const responseCols=blocks.map(b=>b.stu);
      if(labeledNonLearner(row,headers,responseCols,KEY_ROW_LABEL)||
          labeledNonLearner(row,headers,responseCols,/^(?:grand\s+total|totals?|averages?|mean)\s*:?$/i)){skipped++;continue;}
      // An empty row is never an examinee.
      if (!row.some(v=>clean(v)) || (!blocks.some(b=>
          [b.stu,b.key,b.points,b.mark].some(col=>clean(row[col]))) &&
          ![firstCol,lastCol,studentCol,customCol,earnedCol].some(col=>col>=0&&clean(row[col])))) {skipped++;continue;}
      const answers = blocks.map((b,j) => {
        const parsed=responseToken(row[b.stu]);
        if (!parsed.valid) invalid++;
        else if (!parsed.value) blank++;
        else if (parsed.multiple) multi++;
        const rawKey = clean(row[b.key]);
        if (rawKey) allKeys[j].add(rawKey.toUpperCase());
        return parsed.value;
      });
      const first=firstCol>=0?clean(row[firstCol]):'';
      const last=lastCol>=0?clean(row[lastCol]):'';
      const hasName=Boolean(first||last);
      const name=hasName?[last,first].filter(Boolean).join(', '):`Learner ${learners.length+1}`;
      if (!hasName) nameless++;
      // A repeated StudentID=0 is a provider placeholder, not a roster ID.
      const rawStudent=studentCol>=0?clean(row[studentCol]):'';
      const rawCustom=customCol>=0?clean(row[customCol]):'';
      const usable=(s)=>s && s!=='0' ? s : '';
      const roster=usable(rawCustom)||usable(rawStudent);
      if (!roster) anonymousRoster++;
      else if (seenRoster.has(roster)) warnings.push(`Repeated roster number detected in row ${ri+1}; verify ${JSON.stringify(roster)}.`);
      if (roster) seenRoster.add(roster);
      const rawEarned=earnedCol>=0?clean(row[earnedCol]):'';
      const reportedEarned=rawEarned!==''?Number(rawEarned):NaN;
      const sourceItemPoints = blocks.map(b=>clean(row[b.points])!==''?Number(row[b.points]):NaN);
      if (Number.isFinite(reportedEarned) && sourceItemPoints.every(Number.isFinite) &&
          Math.abs(sourceItemPoints.reduce((a,b)=>a+b,0)-reportedEarned)>1e-8) sourceScoreDiff++;
      learners.push({id:`learner-${ri+1}`,roster,name,answers,sourceRow:ri+1,
        nameMissing:!hasName, reportedEarned:Number.isFinite(reportedEarned)?reportedEarned:null,
        reportedEarnedRaw:rawEarned,
        sourceItemPoints:sourceItemPoints.map(v=>Number.isFinite(v)?v:null),
        sourceItemPointsRaw:blocks.map(b=>clean(row[b.points])),
        sourceMarks:blocks.map(b=>clean(row[b.mark])),
        sourceKeys:blocks.map(b=>clean(row[b.key]))});
    }
    if (!learners.length) throw new Error('No learner-response rows were found in this ZipGrade CSV.');
    const key=allKeys.map((ks,j)=>{
      if (ks.size===1) {
        const parsed=keyToken([...ks][0]);
        if (parsed && parsed.length) return parsed;
      }
      if (ks.size>1) warnings.push(`Q${j+1}: conflicting PriKey values between learner rows; verify the key manually.`);
      else warnings.push(`Q${j+1}: answer key missing or unrecognized in PriKey${j+1}.`);
      return [];
    });
    if (nameless) warnings.push(`${nameless} learner record(s) have no FirstName/LastName. Temporary row labels are shown; no names were inferred.`);
    if (anonymousRoster) warnings.push(`${anonymousRoster} learner record(s) have no usable roster number (StudentID=0 is treated as missing).`);
    if (multi) warnings.push(`${multi} multiple-mark response(s) (such as AB or BC) are preserved and scored as incorrect for single-choice questions. Inspect if needed.`);
    if (invalid) warnings.push(`${invalid} unrecognized response(s) must be corrected before analysis.`);
    if (blank) warnings.push(`${blank} blank response(s) are scored as incorrect.`);
    if (sourceScoreDiff) warnings.push(`${sourceScoreDiff} source score(s) differ from the sum of ZipGrade Points columns; review the export.`);
    if (skipped) warnings.push(`${skipped} empty/non-learner row(s) skipped.`);
    warnings.push('ZipGrade Points columns contain earned points, not maximum item weights. Source scores are retained. The initial 1-point weights are provisional: review item weights (including zero-point exclusions), accepted answers and scoring modes, then confirm intentional rescoring before analysis. Partial-credit rules cannot be recovered from earned points alone.');
    return {format:'itembloom-normalized-responses',schemaVersion:1,
      provider:'ZipGrade',sourceSchema:'ZipGrade Full Data (Stu/PriKey/Points/Mark)',
      sourceScoring:{earnedPointsColumns:blocks.map(b=>headers[b.points]),maximumItemPoints:null},
      filename:String(filename||''),itemCount:blocks.length,examineeCount:learners.length,
      headers:blocks.map((_,i)=>`Q${i+1}`),answerKey:key,keyConflicts:allKeys.flatMap((ks,i)=>ks.size>1?[i]:[]),points:Array(blocks.length).fill(1),
      learners,invalidCells:invalid,blankCells:blank,multiMarkCells:multi,
      missingNameCount:nameless,warnings};
  }
  function identify(rows, filename) {
    const beginning = rows.slice(0, 8).map(x => x.join(' ')).join(' ').toLowerCase();
    const name = String(filename || '').toLowerCase();
    if (zipGradeFullColumns(rows[0])) return 'ZipGrade';
    if (name.includes('zipgrade') || beginning.includes('zipgrade')) return 'ZipGrade';
    if (name.includes('evalbee') || beginning.includes('evalbee')) return 'EvalBee';
    return 'Generic CSV';
  }
  function pickHeader(rows) {
    const candidates = rows.slice(0, Math.min(rows.length, 12)).map((row,i) => {
      const nums = row.map((x,j)=>({number:questionNumber(x),col:j})).filter(x=>x.number != null);
      const uniq = [...new Set(nums.map(x=>x.number))];
      const nonempty = row.filter(x=>clean(x)).length;
      const named = row.some(x=>/\b(?:name|first|last|student|learner|roster|roll)\b/.test(norm(x)));
      const explicit = row.filter(x=>/^(?:q|question|item|response|answer|choice|option)\s*0*\d+/i.test(clean(x))).length;
      const bareHeader=row.filter(x=>clean(x)).every(x=>/^\d+$/.test(clean(x))&&questionNumber(x)!=null);
      const plausible=nums.length>0&&(explicit>0||named||bareHeader);
      return {index:i,nums,uniq,plausible,score:plausible?uniq.length * 10 + explicit*25 + (named?50:0) + (nonempty>=3?1:0):-1};
    });
    const best = candidates.sort((a,b)=>b.score-a.score)[0];
    if (!best || !best.plausible || best.uniq.length < 1) throw new Error('Question columns were not recognized. Export the full results CSV with individual responses (Q1, Q2, …), not the summary-only CSV.');
    return best.index;
  }
  // Many provider exports contain supplementary columns for a question (such as
  // Q1 Score, Q1 Options, Q1 Response). Only one column is the learner response.
  // Identify that column from the header AND the observed cell values. Never
  // treat a duplicate question number alone as proof that the CSV is malformed.
  function selectResponseColumns(rows, headerIndex, headers) {
    const groups = new Map();
    const warnings = [];
    const namedQuestionExists = headers.some(h => questionNumber(h) != null && !/^\s*0*\d+\s*$/.test(clean(h)));
    const sampleRows = rows.slice(headerIndex + 1, headerIndex + 51).filter(row =>
      !row.some((x, j) => questionNumber(headers[j]) === null && /^(?:answer\s*key|correct\s*answers?|key|total|average)$/i.test(clean(x)))
    );
    headers.forEach((raw, col) => {
      const n = questionNumber(raw);
      if (n === null) return;
      // Purely numeric headers can be ordinary CSV metadata. Prefer an explicit
      // Q#/Question# set whenever both syntaxes are present.
      if (namedQuestionExists && /^\s*0*\d+\s*$/.test(clean(raw))) return;
      const values = sampleRows.map(row => clean(row[col])).filter(Boolean);
      const nValues = values.length || 1;
      const letterResponses = values.filter(v => /^(?:[A-J]|T|F|TRUE|FALSE)$/i.test(v)).length;
      const binaryScores = values.filter(v => /^(?:0|1|TRUE|FALSE)$/i.test(v)).length;
      const invalidValues = values.filter(v => !responseToken(v).valid).length;
      const normalized = norm(raw);
      let priority = 0;
      if (/\b(?:response|selected|selection|marked)\b/.test(normalized)) priority += 35;
      else if (/\b(?:answer|choice)\b/.test(normalized)) priority += 20;
      else if (/\boptions?\b/.test(normalized)) priority += 4;
      if (/^(?:q|question|item)\s*0*\d+$/.test(normalized)) priority += 20;
      if (values.length) {
        priority += Math.round(letterResponses / nValues * 40);
        priority -= Math.round(binaryScores / nValues * 30);
        priority -= Math.round(invalidValues / nValues * 35);
      } else priority -= 20;
      const candidate = {col, raw:clean(raw), values, priority,
        letterRatio:letterResponses/nValues, binaryRatio:binaryScores/nValues,
        distinct:new Set(values.map(v => v.toUpperCase())).size};
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(candidate);
    });
    const numberCols = new Map();
    for (const [n, all] of groups) {
      if (all.length === 1) {numberCols.set(n, all[0].col);continue;}
      const labels = all.map(c=>`column ${c.col+1} (${JSON.stringify(c.raw)})`).join(', ');
      // Identical header labels may also occur in valid provider exports, e.g.
      // Q1 scored 0/1 alongside another Q1 containing the selected A-E answer.
      const repeated = new Set(all.map(c=>norm(c.raw))).size !== all.length;
      const ranked = [...all].sort((a,b) => b.priority-a.priority || a.col-b.col);
      const best = ranked[0], next = ranked[1];
      const matches = a => a.values.length === best.values.length && a.values.every((v,i)=>v === best.values[i]);
      const identical = ranked.slice(1).every(matches);
      // Identical response data across duplicate differently named columns is
      // redundant, not a conflict. Prefer the most explicit response label.
      const sufficientDifference = best.priority-next.priority >= 20 && best.letterRatio >= .5 &&
        (next.letterRatio < .5 || next.binaryRatio >= .8 || next.priority <= best.priority-35);
      if (!identical && !sufficientDifference) {
        throw new Error(`${repeated?'Duplicate question':'Ambiguous'} Q${n} columns: ${labels}. ItemBloom cannot safely determine which contains learner-selected answers. Please supply a sample of the CSV header (without learner names) to update this adapter.`);
      }
      numberCols.set(n, best.col);
      warnings.push(`Q${n}: used ${JSON.stringify(best.raw)} (column ${best.col+1}); ignored supplementary columns: ${ranked.slice(1).map(c=>JSON.stringify(c.raw)).join(', ')}.`);
    }
    return {numberCols, warnings};
  }
  const KEY_ROW_LABEL = /^(?:answer\s*keys?|answerkey|official\s*(?:answers?|keys?)|correct\s*(?:answers?|choices?|keys?)|correctanswer(?:s)?|right\s*answers?|key\s*answers?|keys?)\s*:?$/i;
  // A row label must lead the metadata and have no separate learner identity.
  // A section/comment containing "Total" or "Key" is not a summary/key row.
  function labeledNonLearner(row, headers, qCols, label) {
    const metadata=headers.map((_,i)=>i).filter(i=>!qCols.includes(i)&&clean(row[i]));
    const first=metadata[0];
    if(first===undefined||!label.test(clean(row[first])))return false;
    return !metadata.some(i=>i!==first &&
      (ID_HEADER.test(norm(headers[i]))||/^(?:(?:first|given|last|family|full|student|learner) ?name|forename|surname|name|student|learner)$/.test(norm(headers[i]))));
  }
  function csvRowKind(row,headers,qCols){if(!row.some(v=>clean(v)))return 'empty';if(labeledNonLearner(row,headers,qCols,KEY_ROW_LABEL))return 'key';if(labeledNonLearner(row,headers,qCols,/^(?:grand\s+total|totals?|averages?|mean)\s*:?$/i))return 'summary';return 'learner';}
  function extractOfficialKeys(rows, headers, qCols, headerIndex, itemCount) {
    const keyRows=new Set(), keyWarnings=[], candidates=[], conflicts=new Set();
    for(let ri=headerIndex+1;ri<rows.length;ri++) {
      const row=rows[ri];
      if(!labeledNonLearner(row,headers,qCols,KEY_ROW_LABEL)) continue;
      keyRows.add(ri);
      const values=qCols.map(col=>keyToken(row[col]));
      candidates.push({label:`answer-key row ${ri+1}`,values,valid:values.filter(v=>v&&v.length).length});
    }
    // Exports may provide separate official-key columns alongside Qn response
    // columns (e.g. Correct1, Key_Q2, Q3_AnswerKey).
    const byNumber=new Map();
    headers.forEach((h,i)=>{
      const normed=norm(h);
      let m=normed.match(/^(?:answer\s*key|answerkey|correct(?:\s*answer)?|official\s*key|key)\s*(?:q|question|item)?\s*0*(\d+)$/);
      if(!m) m=normed.match(/^(?:q|question|item)\s*0*(\d+)\s*(?:answer\s*key|answerkey|correct(?:\s*answer)?|official\s*key|key)$/);
      if(m && Number(m[1])>=1 && Number(m[1])<=itemCount) {
        if(!byNumber.has(Number(m[1]))) byNumber.set(Number(m[1]),[]);
        byNumber.get(Number(m[1])).push(i);
      }
    });
    if(byNumber.size){
      const values=Array.from({length:itemCount},()=>[]);
      for(let q=1;q<=itemCount;q++) {
        const cols=byNumber.get(q)||[];
        const seen=new Map();
        for(let ri=headerIndex+1;ri<rows.length;ri++) {
          if(keyRows.has(ri))continue;
          for(const col of cols) {
            const raw=clean(rows[ri][col]);if(!raw)continue;
            const tokens=keyToken(raw);
            if(tokens?.length) seen.set(tokens.join('|'),tokens);
          }
        }
        if(seen.size===1) values[q-1]=[...seen.values()][0];
        else if(seen.size>1){conflicts.add(q-1);keyWarnings.push(`Q${q}: conflicting official-key columns; verify its key.`);}
      }
      candidates.push({label:'official-key columns',values,valid:values.filter(v=>v.length).length});
    }
    // Some exports carry the complete official key in one dedicated metadata
    // column. Accept it only when its token count exactly matches itemCount;
    // never derive or guess keys from learner answer frequencies.
    const compactCols=headers.map((h,i)=>({h:norm(h),i})).filter(x=>!qCols.includes(x.i)&&/^(?:answer key|answerkey|official key|correct answers?|correct answer key)$/.test(x.h));
    for(const col of compactCols){
      const found=new Map();
      for(let ri=headerIndex+1;ri<rows.length;ri++){
        if(keyRows.has(ri))continue;
        const raw=clean(rows[ri][col.i]);if(!raw)continue;
        let seq=raw.split(/[\s,;|]+/).filter(Boolean);
        if(seq.length===1&&/^[A-J]{3,}$/.test(seq[0])&&seq[0].length===itemCount)seq=[...seq[0]];
        if(seq.length!==itemCount)continue;
        const parsed=seq.map(keyToken);
        if(parsed.every(x=>x?.length))found.set(JSON.stringify(parsed),parsed);
      }
      if(found.size===1){
        const values=[...found.values()][0];
        candidates.push({label:`compact official key column ${col.i+1}`,values,valid:itemCount});
      }else if(found.size>1){const variants=[...found.values()];for(let j=0;j<itemCount;j++)if(new Set(variants.map(k=>[...k[j]].sort().join('|'))).size>1)conflicts.add(j);keyWarnings.push('Competing complete answer keys were found in a compact-key column; verify manually.');}
    }
    const best=[...candidates].sort((a,b)=>b.valid-a.valid)[0];
    const key=best?best.values.map(v=>v||[]):Array.from({length:itemCount},()=>[]);
    if(!best) keyWarnings.push('No explicit official answer key was found. Import the key or enter it in the Answer Key Editor; learner answers are never used to guess keys.');
    else {
      keyWarnings.push(`Extracted ${best.valid}/${itemCount} official answers from ${best.label}.`);
      if(best.valid<itemCount) keyWarnings.push(`${itemCount-best.valid} official key(s) are blank or invalid; complete them in the Answer Key Editor.`);
      for(const c of candidates.filter(c=>c!==best)) for(let j=0;j<itemCount;j++) {
        if(c.values[j]?.length&&key[j]?.length&&[...c.values[j]].sort().join('|')!==[...key[j]].sort().join('|')){
          keyWarnings.push(`Q${j+1}: competing key sources disagree (${best.label} vs ${c.label}); verify manually.`);
          conflicts.add(j);key[j]=[];
        }
      }
    }
    for(const j of conflicts)key[j]=[];
    return {key,keyRows,keyWarnings,keyConflicts:[...conflicts]};
  }
  function extract(text, filename) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('CSV is too large (15 MB maximum).');
    const parsed = parseCSV(text);
    return extractRows(parsed.rows,filename);
  }
  function extractRows(rows,filename) {
    if (!Array.isArray(rows)||rows.length<2) throw new Error('Results require a header and learner rows.');
    if (rows.some(r=>r.length>MAX_COLUMNS) || rows.length>MAX_ROWS) throw new Error('Worksheet exceeds import limits.');
    // The real ZipGrade export has one header row followed by numeric PointsN
    // columns. Picking the header by numeric-cell frequency mistakenly selects
    // a student data row and produces dozens of bogus duplicate Q1 columns.
    const zipIndex = rows.slice(0,Math.min(rows.length,12)).findIndex(r=>zipGradeFullColumns(r));
    if (zipIndex>=0) return extractZipGradeFull(rows,filename,zipIndex,zipGradeFullColumns(rows[zipIndex]));
    const provider = identify(rows, filename);
    const headerIndex = pickHeader(rows);
    const headers = rows[headerIndex];
    const selection = selectResponseColumns(rows, headerIndex, headers);
    const numberCols = selection.numberCols;
    const sorted = [...numberCols.keys()].sort((a,b)=>a-b);
    if (sorted[0] !== 1 || sorted.some((n,i)=>n!==i+1)) throw new Error('Question columns are not a complete sequence starting at Q1. Check missing or shifted columns.');
    const itemCount = sorted.length;
    const qCols = sorted.map(n=>numberCols.get(n));
    const normalizedHeaders = headers.map(norm);
    const headerIndexOf = (re) => normalizedHeaders.findIndex(x=>re.test(x));
    let firstCol = headerIndexOf(/^(?:first|given|forename)(?: name)?$/),
        lastCol = headerIndexOf(/^(?:last|family|surname)(?: name)?$/),
        nameCol = headerIndexOf(/^(?:name|full name|student name|learner name|student|learner)$/);
    if (firstCol<0 && lastCol<0 && nameCol<0 && provider==='ZipGrade' && headers.length>3 && !qCols.includes(2) && !qCols.includes(3)) { firstCol=2; lastCol=3; }
    if (firstCol<0 && lastCol<0 && nameCol<0 && provider==='EvalBee' && headers.length>3 && !qCols.includes(3)) nameCol=3;
    // Learner names and roster numbers are optional in real ZipGrade/EvalBee exports.
    // Never discard a valid response row merely because identifying fields are blank.
    const idCol = normalizedHeaders.findIndex(x => ID_HEADER.test(x));
    const warnings = [...selection.warnings];
    const {key,keyRows,keyWarnings,keyConflicts} = extractOfficialKeys(rows,headers,qCols,headerIndex,itemCount);
    warnings.push(...keyWarnings);
    const learners = [];
    let invalid=0,blank=0, skipped=0, nameless=0, noRoster=0, multiple=0;
    for (let ri=headerIndex+1;ri<rows.length;ri++) {
      const row=rows[ri];
      if (keyRows.has(ri)) continue;
      if (labeledNonLearner(row,headers,qCols,/^(?:grand\s+total|totals?|averages?|mean)\s*:?$/i)) { skipped++; continue; }
      const first=firstCol>=0?clean(row[firstCol]):'', last=lastCol>=0?clean(row[lastCol]):'';
      const actualName = nameCol>=0?clean(row[nameCol]):[last,first].filter(Boolean).join(', ');
      const answers = qCols.map(col=>responseToken(row[col]));
      if (!row.some(v=>clean(v))) {skipped++;continue;}
      const name = actualName || `Learner ${learners.length+1}`;
      if(!actualName) nameless++;
      const rawId = idCol>=0?clean(row[idCol]):'';
      const ident = rawId==='0'? '' : rawId;
      if(!ident) noRoster++;
      answers.forEach(a=>{if (!a.valid) invalid++; else if (!a.value) blank++; else if (a.multiple) multiple++;});
      learners.push({ id: `learner-${ri+1}`, roster:ident, name, nameMissing:!actualName, answers: answers.map(a=>a.value), sourceRow:ri+1 });
    }
    if (!learners.length) throw new Error('No learner-response rows were found.');
    if (nameless) warnings.push(`${nameless} learner record(s) have no name. Temporary Learner labels were assigned.`);
    if (noRoster) warnings.push(`${noRoster} learner record(s) have no usable roster number; '0' is treated as a placeholder.`);
    if (multiple) warnings.push(`${multiple} multiple-marked response(s) were preserved; they earn credit only under 'All required' with an exact match.`);
    if (invalid) warnings.push(`${invalid} unrecognized answer cell(s). Check these values before analyzing.`);
    if (blank) warnings.push(`${blank} blank learner response(s); blanks are scored as incorrect by default.`);
    const uniqueId = new Set(), duplicateId=[];
    learners.forEach(x=>{ if (x.roster) {if (uniqueId.has(x.roster)) duplicateId.push(x.roster); uniqueId.add(x.roster);} });
    if (duplicateId.length) warnings.push(`Duplicate roster numbers detected: ${[...new Set(duplicateId)].slice(0,5).join(', ')}. Check before proceeding.`);
    const names = learners.map(x=>x.name.toLowerCase());
    const named = learners.filter(x=>!x.nameMissing).map(x=>x.name.toLowerCase());
    if (new Set(named).size < named.length) warnings.push('Repeated actual learner names were found; distinguish using roster numbers where available.');
    if (skipped) warnings.push(`${skipped} non-learner or incomplete row(s) were skipped.`);
    return {format:'itembloom-normalized-responses',schemaVersion:1,provider,filename:String(filename||''),itemCount,examineeCount:learners.length,headers:sorted.map(n=>`Q${n}`),answerKey:key,points:Array(itemCount).fill(1),learners,invalidCells:invalid,blankCells:blank,multiMarkCells:multiple,missingNameCount:nameless,keyConflicts,warnings};
  }
  // A correct answer can mean ONE of the accepted choices, or the COMPLETE
  // multiple-select key. All-required receives all points only for an exact set
  // match: neither missing nor additional selected options are accepted.
  function correctAnswer(response, accepted, mode) {
    const a = responseToken(response);
    if (!a.valid || !a.value) return false;
    const tokens = [...new Set(accepted)].sort();
    if (mode === 'all') {
      const selected = a.multiple ? [...a.value] : [a.value];
      return selected.length===tokens.length && selected.every(v=>tokens.includes(v));
    }
    return !a.multiple && tokens.includes(a.value);
  }
  function score(parsed, key, points, passThreshold, modes, choiceCounts, groupPercent=27) {
    const n = parsed.itemCount;
    if (!Array.isArray(key) || key.length!==n) throw new Error('Answer key does not match the item count.');
    if (!Array.isArray(points) || points.length!==n || points.some(x=>!Number.isFinite(Number(x)) || Number(x)<0)) throw new Error('Invalid item point values.');
    if (key.some((arr,i)=>Number(points[i])>0 && (!Array.isArray(arr) || !arr.length))) throw new Error('All items carrying points need a correct answer.');
    if (parsed.invalidCells) throw new Error('Unrecognized answer values must be corrected or explicitly marked blank before analyzing.');
    const m = modes||Array(n).fill('any'), c=choiceCounts||Array(n).fill(10);
    if (m.length!==n || m.some(x=>!['any','all'].includes(x))) throw new Error('Invalid multiple-answer scoring mode.');
    if (c.length!==n || c.some(x=>!Number.isInteger(Number(x))||x<2||x>10)) throw new Error('The number of choices must be from 2 to 10.');
    if (!Number.isFinite(passThreshold)||passThreshold<0||passThreshold>100) throw new Error('Passing threshold must be between 0 and 100%.');
    if (!Number.isFinite(groupPercent)||groupPercent<1||groupPercent>50) throw new Error('Upper/lower group percentage must be between 1% and 50%.');
    for(let j=0;j<n;j++){
      const allowed = new Set(Array.from({length:Number(c[j])},(_,i)=>String.fromCharCode(65+i)));
      // True/False is represented as T/F independently of the A–J option count.
      const trueFalse=key[j].includes('T')||parsed.learners.some(l=>l.answers[j]==='T');
      if (Number(points[j])>0 && key[j].some(k=>/^[A-J]$/.test(k)&&!allowed.has(k)&&!(k==='F'&&trueFalse)))
        throw new Error(`Item ${j+1}: accepted answer exceeds its configured ${c[j]} choices. Adjust the number of choices or the key.`);
    }
    const max=points.reduce((s,v)=>s+Number(v),0);
    if (max<=0) throw new Error('At least one item must carry points.');
    const credits=parsed.learners.map(l=>l.answers.map((ans,j)=>Number(points[j])>0&&correctAnswer(ans,key[j],m[j])?1:0));
    const totals=credits.map(row=>row.reduce((sum,credit,j)=>sum+credit*Number(points[j]),0));
    const mean=totals.reduce((a,b)=>a+b,0)/totals.length;
    const sd=Math.sqrt(totals.reduce((s,v)=>s+(v-mean)**2,0)/totals.length);
    const pct=totals.map(v=>v/max*100);
    const pass=pct.filter(x=>x+1e-9>=passThreshold).length;
    const indices=totals.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v||a.i-b.i);
    // Recommended classical upper/lower group fraction is 27%. Round to the
    // nearest learner; never overlap groups. With fewer than two learners,
    // discrimination is undefined (instead of comparing one learner to self).
    const g=parsed.learners.length>=2?Math.max(1,Math.min(Math.floor(parsed.learners.length/2),Math.round(parsed.learners.length*groupPercent/100))):0;
    const upper=indices.slice(0,g).map(x=>x.i), lower=g?indices.slice(-g).map(x=>x.i):[];
    const boundaryTies=g>0&&g<indices.length&&((indices[g-1].v===indices[g].v)||(indices[indices.length-g-1].v===indices[indices.length-g].v));
    const perItem=Array.from({length:n},(_,j)=>{
      const eligible=Number(points[j])>0;
      const correct=credits.reduce((s,row)=>s+row[j],0);
      const p=eligible?correct/parsed.examineeCount:null;
      const ug=upper.filter(i=>credits[i][j]).length;
      const lg=lower.filter(i=>credits[i][j]).length;
      const d=eligible&&sd>0&&g>0?(ug/g-lg/g):null;
      const choices={};parsed.learners.forEach(l=>{const v=l.answers[j]||'(blank)';choices[v]=(choices[v]||0)+1;});
      let action='Retain', reason='Item statistics are generally acceptable; verify content alignment and distractors.';
      if (!eligible) {action='Review';reason='This item carries zero points and is excluded from scored analysis.';}
      else if (sd===0 || g===0) {action='Review';reason='Scores or group size do not allow reliable discrimination for this sample.';}
      else if (parsed.examineeCount<10) {action='Review';reason='Small sample: interpret difficulty and discrimination cautiously.';}
      else if (d<0) {action='Review';reason='Negative discrimination: the lower-scoring group outperformed the upper-scoring group. Check the key and question.';}
      else if (d<.2) {action='Revise';reason='Weak discrimination. Review wording, answer options, and alignment with the lesson.';}
      else if (p<.2) {action='Revise';reason='Very few learners answered correctly. Check difficulty, instruction, and distractors.';}
      else if (p>.8) {action='Revise';reason='Most learners answered correctly. Verify whether the question is intentionally assessing foundational knowledge.';}
      return {item:j+1,p,d,correct,choices,upperCorrect:ug,lowerCorrect:lg,action,reason};
    });
    const sortTotals=[...totals].sort((a,b)=>a-b),mid=sortTotals.length/2;
    const median=Number.isInteger(mid)?(sortTotals[mid-1]+sortTotals[mid])/2:sortTotals[Math.floor(mid)];
    return {total:max,mean,median,sd,mps:mean/max*100,passed:pass,below:parsed.examineeCount-pass,threshold:passThreshold,totals,pct,perItem,groupPercent,groupSize:g,boundaryTies};
  }
  return {csvRowKind,parseCSV,extract,extractRows,extractOfficialKeys,score,correctAnswer,questionNumber,keyToken,responseToken,MAX_BYTES};
});
