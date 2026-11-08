/* Local, deterministic desk-idle deformation. No generated frames or media. */
(() => {
  'use strict';
  const REGION = Object.freeze({x:738, y:224, width:432, height:496});
  const PERIOD = 4.2;
  const STEP = 1000 / 24;
  // Conservative inset silhouette: fixed table, hands, chair and room are
  // outside it. An inner feather pins its boundary rather than moving a cutout.
  const OUTLINE = [
    [782,350],[800,318],[836,288],[871,245],[921,236],[947,246],
    [976,228],[1012,240],[1030,261],[1065,266],[1081,291],[1105,304],
    [1118,333],[1138,353],[1155,389],[1165,444],[1142,479],[1125,539],
    [1127,585],[1098,630],[1093,675],[1111,720],[791,720],[808,684],
    [817,650],[838,612],[816,577],[783,553],[768,518],[755,470],[765,404]
  ];
  let maskCache;

  function mask() {
    if (maskCache) return maskCache;
    const {x,y,width,height} = REGION;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', {willReadFrequently:true});
    context.beginPath();
    OUTLINE.forEach(([px,py], i) => context[i ? 'lineTo' : 'moveTo'](px-x,py-y));
    context.closePath(); context.fillStyle = '#fff'; context.fill();
    const pixels = context.getImageData(0,0,width,height);
    for (let py=0; py<height; py++) for (let px=0; px<width; px++) {
      const offset = 4*(py*width+px);
      let distance = 0;
      if (pixels.data[offset+3] === 255) {
        distance = Infinity;
        for (let a=OUTLINE.length-1,b=0; b<OUTLINE.length; a=b++) {
          const [ax,ay]=OUTLINE[a], [bx,by]=OUTLINE[b];
          const vx=bx-ax, vy=by-ay;
          const u=Math.max(0,Math.min(1,((px+x-ax)*vx+(py+y-ay)*vy)/(vx*vx+vy*vy)));
          distance=Math.min(distance,Math.hypot(px+x-ax-u*vx,py+y-ay-u*vy));
        }
      }
      const u=Math.min(1,Math.max(0,(distance-2)/16));
      const weight=Math.round(255*u*u*(3-2*u));
      pixels.data[offset]=pixels.data[offset+1]=pixels.data[offset+2]=weight;
      pixels.data[offset+3]=255;
    }
    context.putImageData(pixels,0,0);
    maskCache=canvas;
    return canvas;
  }

  window.createRoomIdleBreath = ({scene, image, canvas}) => {
    let gl=null, program=null, buffer=null, textures=[];
    let amountLocation, active=false, paused=false, frame=0, frames=0, amount=0;
    let token=0, source='', clockStart=0, elapsed=0, lastDraw=-Infinity;
    let settleStart=null, settleAmount=0, settleResolve=null;
    let unavailable=false;

    function layout() {
      if (!active || !image.naturalWidth) return;
      const scale=Math.min(scene.clientWidth/image.naturalWidth,scene.clientHeight/image.naturalHeight);
      canvas.style.left=((scene.clientWidth-image.naturalWidth*scale)/2+REGION.x*scale)+'px';
      canvas.style.top=((scene.clientHeight-image.naturalHeight*scale)/2+REGION.y*scale)+'px';
      canvas.style.width=(REGION.width*scale)+'px';
      canvas.style.height=(REGION.height*scale)+'px';
    }
    function shader(type, text) {
      const compiled=gl.createShader(type);
      gl.shaderSource(compiled,text); gl.compileShader(compiled);
      if (!gl.getShaderParameter(compiled,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(compiled));
      gl.attachShader(program,compiled);
      gl.deleteShader(compiled);
    }
    function texture(value, unit) {
      const result=gl.createTexture(); textures.push(result);
      gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,result);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,value);
    }
    function allocate() {
      canvas.width=REGION.width; canvas.height=REGION.height;
      gl=canvas.getContext('webgl',{alpha:true,antialias:false,preserveDrawingBuffer:false,premultipliedAlpha:true,powerPreference:'low-power'});
      if (!gl) throw new Error('WebGL unavailable');
      program=gl.createProgram();
      shader(gl.VERTEX_SHADER, 'attribute vec2 point; varying vec2 uv; void main(){gl_Position=vec4(point,0.,1.); uv=vec2((point.x+1.)*.5,(1.-point.y)*.5);}');
      shader(gl.FRAGMENT_SHADER, `precision highp float;
        varying vec2 uv; uniform sampler2D original; uniform sampler2D mask;
        uniform float amount;
        void main(){
          float w=texture2D(mask,uv).r;
          if(w<0.001 || amount<0.00001) discard;
          vec2 p=uv*vec2(432.,496.)+vec2(738.,224.);
          float anchor=1.-smoothstep(565.,720.,p.y);
          float lift=1.45*anchor;
          float expand=0.23*(p.x-953.)/212.*(1.-smoothstep(650.,720.,p.y));
          vec2 sampleUV=uv+vec2(-expand,lift)*amount*w/vec2(432.,496.);
          // The matte must feather coverage as well as displacement. Keep
          // RGB premultiplied so scaled transparent edges cannot interpolate
          // toward an opaque black polygon in the browser compositor.
          vec4 color=texture2D(original,sampleUV);
          // Fade in the alternate sampled layer continuously at rest. Its
          // coverage is complete by 2% breath amplitude, so the breathing
          // peak stays unchanged and near-zero motion keeps source pixels.
          float coverage=w*smoothstep(0.,0.02,amount)*color.a;
          gl_FragColor=vec4(color.rgb*coverage,coverage);
        }`);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program);
      buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      const point=gl.getAttribLocation(program,'point');
      gl.enableVertexAttribArray(point); gl.vertexAttribPointer(point,2,gl.FLOAT,false,0,0);
      const cropped=document.createElement('canvas'); cropped.width=REGION.width; cropped.height=REGION.height;
      cropped.getContext('2d').drawImage(image,REGION.x,REGION.y,REGION.width,REGION.height,0,0,REGION.width,REGION.height);
      texture(cropped,0); texture(mask(),1);
      gl.uniform1i(gl.getUniformLocation(program,'original'),0);
      gl.uniform1i(gl.getUniformLocation(program,'mask'),1);
      amountLocation=gl.getUniformLocation(program,'amount');
      gl.viewport(0,0,REGION.width,REGION.height); gl.clearColor(0,0,0,0);
    }
    function draw(nextAmount) {
      if (!gl || !active) return;
      amount=nextAmount;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(amountLocation,amount);
      gl.drawArrays(gl.TRIANGLES,0,6);
      frames++;
    }
    function breath(seconds) { return (1-Math.cos(2*Math.PI*seconds/PERIOD))/2; }
    function stopClock() { if(frame) cancelAnimationFrame(frame); frame=0; }
    function completeSettle() {
      draw(0); stopClock(); paused=true; settleStart=null;
      if(settleResolve) { const resolve=settleResolve; settleResolve=null; resolve(); }
    }
    function tick(now) {
      frame=0;
      if(!active || paused || document.visibilityState!=='visible') return;
      elapsed=(now-clockStart)/1000;
      if(settleStart!==null) {
        const u=Math.min(1,(now-settleStart)/180);
        if(u===1) { completeSettle(); return; }
        if(now-lastDraw>=STEP) { draw(settleAmount*(1-u*u*(3-2*u))); lastDraw=now; }
      } else if(now-lastDraw>=STEP) { draw(breath(elapsed)); lastDraw=now; }
      frame=requestAnimationFrame(tick);
    }
    function resume() {
      if(!active || settleStart!==null) return;
      paused=false; clockStart=performance.now()-elapsed*1000; lastDraw=-Infinity;
      if(document.visibilityState==='visible' && !frame) frame=requestAnimationFrame(tick);
    }
    function hide() {
      token++; stopClock(); canvas.hidden=true; active=false; paused=false; amount=0;
      if(settleResolve) { const resolve=settleResolve; settleResolve=null; resolve(); }
      settleStart=null;
      if(gl) {
        textures.forEach(value=>gl.deleteTexture(value)); textures=[];
        if(buffer) gl.deleteBuffer(buffer);
        if(program) gl.deleteProgram(program);
      }
      buffer=program=null;
      // A zero-sized backing store releases the local GPU framebuffer between
      // A visits; the cheap context can be reused without context-loss churn.
      canvas.width=canvas.height=0; gl=null;
    }
    async function enter() {
      const nextSource=image.currentSrc || image.src;
      if(unavailable || (active && source===nextSource)) return;
      hide();
      const owner=++token;
      try {
        await image.decode();
        if(owner!==token || scene.dataset.state!=='A') return;
        source=image.currentSrc || image.src; active=true; elapsed=0;
        allocate(); layout(); draw(0); canvas.hidden=false; resume();
      } catch(reason) {
        if(owner!==token) return;
        hide(); unavailable=true;
        // Preserve the original still on unsupported GPUs; media playback
        // and the server's turn ownership never depend on this enhancement.
        console.warn('Desk idle breathing unavailable:',reason.message);
      }
    }
    function settle() {
      // A pending image.decode() must not start an idle clock after an
      // incoming motion has already acquired its video owner.
      token++;
      if(!active) return Promise.resolve();
      if(settleResolve) return new Promise(resolve=>{const previous=settleResolve;settleResolve=()=>{previous();resolve();};});
      settleAmount=breath(elapsed); settleStart=performance.now(); paused=false;
      if(document.visibilityState!=='visible' || settleAmount<0.00001) { completeSettle(); return Promise.resolve(); }
      const promise=new Promise(resolve=>{settleResolve=resolve;});
      if(!frame) frame=requestAnimationFrame(tick);
      return promise;
    }
    // Deterministic, production-useful seek for visual review/export. It owns
    // only the code animation clock and never seeks any supplied video.
    function seek(seconds) {
      if(!active || !Number.isFinite(seconds)) return;
      stopClock(); paused=true; elapsed=Math.max(0,seconds); draw(breath(elapsed));
    }
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState!=='visible') {
        stopClock();
        if(settleStart!==null) completeSettle();
      } else if(active && !paused) resume();
    });
    window.addEventListener('resize',layout);
    image.addEventListener('load',()=>{
      if(active && source!==(image.currentSrc || image.src)) { hide(); if(scene.dataset.state==='A') void enter(); }
    });
    return Object.freeze({enter,settle,hide,seek,resume,
      getState:()=>Object.freeze({active,paused,frames,amount,seconds:elapsed,source,region:REGION,period:PERIOD,maxDisplacement:1.47})});
  };
})();
