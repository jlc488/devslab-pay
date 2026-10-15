import {unavailable} from './domain';
export async function boundedJson(response:Response,limit=65536):Promise<unknown>{
 const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>limit))throw unavailable();
 if(!response.body)throw unavailable();const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw unavailable();}chunks.push(value);}}
 finally {reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw unavailable();}
}
