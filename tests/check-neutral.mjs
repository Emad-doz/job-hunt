import assert from 'node:assert/strict';
import {assessMatch,ownWords,MATCH_VERSION} from '../server/matching.mjs';
import {describeReply,classifyReply} from '../server/mail.mjs';
import {sanitizeCvText} from '../server/analyst-ai.mjs';
import {storedCv} from '../server/cv-reader.mjs';

// Rules that do not assume one profession or two languages. Synthetic people, vacancies and emails only.
assert.equal(MATCH_VERSION,'cv-role-evidence-v6');
// The owner's own words: skills and job titles from My CV plus the search terms, tidied, without duplicates, bounded.
const details={headline:'Kinderverpleegkundige | Paediatric nurse',skills:['Wondzorg','Triage','BLS / PALS','C++','triage','x',' '],experience:[{title:'Senior Paediatric Nurse'},{title:'Verpleegkundige spoedeisende hulp'},{title:''}]};
const own=ownWords(details,['Paediatric nurse','ICU nurse']);
assert.deepEqual(own.ownSkills,['Wondzorg','triage','BLS / PALS','C++']);assert.deepEqual(own.ownRoles,['Paediatric nurse','ICU nurse','Kinderverpleegkundige','Senior Paediatric Nurse','Verpleegkundige spoedeisende hulp']);
assert.deepEqual(ownWords(null),{ownSkills:[],ownRoles:[]});assert.equal(ownWords({skills:Array.from({length:200},(_,i)=>'Synthetic skill '+i)}).ownSkills.length,60);

// A profession the built-in families know nothing about: role by title words in any order and without rank, skills by name, accents and capitals ignored.
const nurse={skills:[],evidence:[],roleFamilies:[],legalBackground:false,...own};
const fit=assessMatch({title:'Nurse, Paediatric (Senior) - Night shifts',description:'You have experience with triage and wondzorg. BLS/PALS certificate required.'},nurse);
assert.deepEqual([fit.eligible,fit.basis,fit.label,fit.roleMatches,fit.coreSkills],[true,'rules','Closer CV match',['Paediatric nurse','Senior Paediatric Nurse'],['Wondzorg','triage','BLS / PALS']]);
const dutch=assessMatch({title:'Verpleegkundige Spoedeisende Hulp (SEH)',description:'Ervaring met triage is een pré.'},nurse);assert.deepEqual([dutch.eligible,dutch.roleMatches,dutch.coreSkills,dutch.label],[true,['Verpleegkundige spoedeisende hulp'],['triage'],'Possible CV match']);
const accents=assessMatch({title:'Infirmière pédiatrique',description:'Soins et triage.'},{...nurse,ownRoles:['Infirmiere pediatrique']});assert.equal(accents.eligible,true);
// Not enough: the role without a named skill, a skill without the role, a word inside another word, a symbol skill that is not there.
const noSkill=assessMatch({title:'Paediatric Nurse',description:'A caring colleague for our ward.'},nurse);assert.deepEqual([noSkill.eligible,noSkill.label],[false,'Insufficient role evidence']);assert(noSkill.reasons.some(r=>/none of the skills on My CV is named/.test(r)));
const noRole=assessMatch({title:'Warehouse operator',description:'Triage of incoming parcels.'},nurse);assert.equal(noRole.eligible,false);assert(noRole.reasons.some(r=>/job titles on My CV or your search terms/.test(r)));
assert.equal(assessMatch({title:'ICU nurse',description:'Strategic triagesystem ownership, C developer welcome.'},nurse).eligible,false);
assert.deepEqual(assessMatch({title:'ICU nurse',description:'We use C++ and triage.'},nurse).coreSkills,['triage','C++']);
// The built-in list keeps its own careful rules: listing a generic word yourself does not make it specific evidence.
const analyst={skills:['Analytics','SQL'],evidence:[],roleFamilies:['analytics'],legalBackground:false,...ownWords({skills:['Analytics','SQL','Stakeholder collaboration']},[])};
assert.deepEqual(assessMatch({title:'Digital Analyst',description:'Analytics and stakeholder work.'},analyst).coreSkills,[]);assert.deepEqual(assessMatch({title:'Digital Analyst',description:'SQL and analytics.'},analyst).coreSkills,['SQL']);
// A profile saved before this version has no own words and screens as before.
assert.equal(assessMatch({title:'Paediatric Nurse',description:'Triage.'},{skills:[],evidence:[],roleFamilies:[],legalBackground:false}).eligible,false);
// The reader adds the own words to what it reads from the CV, and a failure there never blocks the CV.
const cv=async()=>({text:'Synthetic Person. '+'Paediatric nurse with ward experience and triage training. '.repeat(8),filename:'synthetic.pdf',uploadedAt:'2026-10-08T10:00:00.000Z'});
assert.deepEqual((await storedCv(cv,async()=>own)()).ownRoles,own.ownRoles);assert.equal((await storedCv(cv,async()=>{throw new Error('unavailable');})()).ownSkills,undefined);assert.equal((await storedCv(cv)()).name,'synthetic.pdf');

// Replies in five more languages, read the same way as English and Dutch ones.
const reads=[
  ['Leider müssen wir Ihnen mitteilen, dass wir uns für einen anderen Bewerber entschieden haben.','Rejected'],['Wir müssen Ihnen heute eine Absage erteilen.','Rejected'],['Gerne möchten wir Sie zu einem Vorstellungsgespräch einladen.','Interview'],['Vielen Dank für Ihre Bewerbung. Wir melden uns in Kürze.',''],['Wir freuen uns, Ihnen ein Vertragsangebot zu senden.','Offer'],
  ['Malheureusement, votre candidature n’a pas été retenue.','Rejected'],['Nous souhaitons vous rencontrer : quelles sont vos disponibilités pour un entretien ?','Interview'],['Nous avons bien reçu votre candidature et nous vous en remercions.',''],['Nous conservons votre candidature dans notre vivier.','On hold'],
  ['Lamentablemente hemos decidido no continuar con tu candidatura.','Rejected'],['Nos gustaría invitarte a una entrevista la próxima semana.','Interview'],['Gracias por tu candidatura. Hemos recibido tu solicitud.',''],
  ['Purtroppo non possiamo procedere con la sua candidatura.','Rejected'],['Vorremmo invitarla a un colloquio conoscitivo.','Interview'],['Infelizmente não vamos avançar com a sua candidatura.','Rejected'],['Gostaríamos de marcar uma entrevista consigo.','Interview'],
  ['Unfortunately we have decided not to proceed.','Rejected'],['Helaas gaan wij niet verder met je sollicitatie.','Rejected'],['We would like to invite you for an interview.','Interview']];
for(const [text,status] of reads)assert.equal(describeReply(text).status,status,text);
assert.equal(describeReply('Vielen Dank für Ihre Bewerbung. Wir melden uns in Kürze.').label,'Confirmation that your application arrived');
// Words inside other words do not count, and a text with none of the wording has no outcome.
for(const text of ['Unser Absagemanagement wurde erneuert.','La entrevistadora publicó un libro.','Der neue Katalog ist da, mit vielen Angeboten für den Herbst.'])assert.equal(classifyReply(text),null,text);
assert.equal(describeReply('Dit is een nieuwsbrief over ons kantoor en de zomerborrel van dit jaar.').label,'No clear outcome in this text');

// Contact lines in those languages are taken out before CV text is sent to a model.
const sent=sanitizeCvText(['Synthetic Person','Téléphone : 06 12 34 56 78','Anschrift: Beispielweg 1, Musterstadt','Fecha de nacimiento: 1 de enero','Verpleegkundige met tien jaar ervaring op de kinderafdeling van een ziekenhuis.'].join('\n'));
const kept=typeof sent==='string'?sent:sent.text;assert(kept.includes('kinderafdeling'));for(const gone of ['06 12','Beispielweg','1 de enero'])assert(!kept.includes(gone),gone);
console.log('Neutral rule checks passed: own skills and role names from My CV and the search terms, any word order, no rank, no accents, whole words only, built-in rules kept, older profiles unchanged, replies in German, French, Spanish, Italian and Portuguese, contact lines in those languages removed. Synthetic values only.');
