import {parentPort,workerData} from 'node:worker_threads';
import PDFParser from 'pdf2json';
const parser=new PDFParser(null,1);
parser.on('pdfParser_dataError',()=>parentPort.postMessage({error:'The PDF could not be read. Use an unlocked, text-based PDF.'}));
parser.on('pdfParser_dataReady',()=>{parentPort.postMessage({text:parser.getRawTextContent()});parser.destroy();});
// A dedicated buffer avoids pooled-buffer offsets in the PDF parser.
try{const bytes=Uint8Array.from(workerData);parser.parseBuffer(Buffer.from(bytes.buffer),0);}catch{parentPort.postMessage({error:'The PDF could not be read.'});}
