/* Local, deterministic floor reconstruction. Original media is never changed. */
(() => {
  'use strict';
  if (window.roomMarkCover) return;

  const NATIVE = Object.freeze({width:1916, height:1080});
  const ROI = Object.freeze({x:1686, y:1002, width:204, height:58});
  const TOP = 998;
  const BOTTOM = 1064;
  const SLOPE = 0.96;
  const FEATHER = 6;
  const DONOR_X = 1600;
  const DONOR_WIDTH = NATIVE.width - DONOR_X;
  const scene = document.getElementById('scene');
  const poster = document.getElementById('pose');
  const media = [poster, document.getElementById('clip-a'), document.getElementById('clip-b')].filter(Boolean);
  if (!scene || !poster || !media.length) return;

  const records = [];
  let readyState = 'pending';
  let readyError = null;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve,reject) => {resolveReady=resolve;rejectReady=reject;});
  // The controller attaches its own error handler after this script loads.
  ready.catch(() => {});
  scene.dataset.markReady = 'false';
  const readyTimeout = window.setTimeout(() => failReady(new Error('等待地板标识遮盖超时')),20000);

  function failReady(reason) {
    if (readyState !== 'pending') return;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    readyState = 'failed';
    readyError = error.message;
    window.clearTimeout(readyTimeout);
    scene.dataset.markReady = 'false';
    rejectReady(error);
    scene.dispatchEvent(new CustomEvent('room:mark-cover-error',{bubbles:true,detail:{message:error.message}}));
  }

  function completeReady(record) {
    if (readyState !== 'pending' || record.source !== poster || !record.valid || record.fallback) return;
    readyState = 'ready';
    window.clearTimeout(readyTimeout);
    scene.dataset.markReady = 'true';
    resolveReady({method:'local-diagonal-floor-interpolation'});
    scene.dispatchEvent(new CustomEvent('room:mark-cover-ready',{bubbles:true}));
  }

  window.roomMarkCover = Object.freeze({
    ready,
    refresh,
    getState:() => ({method:'local-diagonal-floor-interpolation',readyState,readyError,native:{...NATIVE},roi:{...ROI},slope:SLOPE,donorPixels:DONOR_WIDTH*2,records:records.map(record => ({id:record.source.id,visible:!record.canvas.hidden,valid:record.valid,fallback:record.fallback,renders:record.renders,sourceTime:record.sourceTime,lastCostMs:record.lastCostMs,maxCostMs:record.maxCostMs,error:record.error}))})
  });
  const scratch = document.createElement('canvas');
  scratch.width = DONOR_WIDTH;
  scratch.height = 2;
  const read = scratch.getContext('2d', {willReadFrequently:true});
  if (!read) {failReady(new Error('无法初始化地板标识遮盖画布'));return;}
  read.imageSmoothingEnabled = false;

  // Each row samples two clean floor rows along the existing diagonal boards.
  // Only 632 donor pixels are read back, never the complete video frame.
  const lookup = new Array(ROI.width * ROI.height);
  for (let y=0; y<ROI.height; y++) {
    const nativeY = ROI.y + y;
    const blend = (nativeY - TOP) / (BOTTOM - TOP);
    for (let x=0; x<ROI.width; x++) {
      const nativeX = ROI.x + x;
      const a = Math.max(0, Math.min(DONOR_WIDTH-1, nativeX + (TOP-nativeY)*SLOPE - DONOR_X));
      const b = Math.max(0, Math.min(DONOR_WIDTH-1, nativeX + (BOTTOM-nativeY)*SLOPE - DONOR_X));
      const edge = Math.min(x, y, ROI.width-1-x, ROI.height-1-y);
      lookup[y*ROI.width+x] = {
        a0:Math.floor(a)*4, a1:Math.min(DONOR_WIDTH-1, Math.floor(a)+1)*4, af:a-Math.floor(a),
        b0:(DONOR_WIDTH+Math.floor(b))*4, b1:(DONOR_WIDTH+Math.min(DONOR_WIDTH-1, Math.floor(b)+1))*4, bf:b-Math.floor(b),
        blend, alpha:Math.round(255*Math.min(1, Math.max(0, edge/FEATHER)))
      };
    }
  }

  function dimensions(source) {
    return source instanceof HTMLVideoElement
      ? [source.videoWidth, source.videoHeight]
      : [source.naturalWidth, source.naturalHeight];
  }

  function available(record) {
    const source = record.source;
    const [width,height] = dimensions(source);
    return width === NATIVE.width && height === NATIVE.height &&
      (source instanceof HTMLVideoElement ? source.readyState >= 2 && !source.seeking : source.complete);
  }

  function position(record) {
    const box = record.source.getBoundingClientRect();
    const parent = scene.getBoundingClientRect();
    const scale = Math.min(box.width/NATIVE.width, box.height/NATIVE.height);
    const x = box.left-parent.left+(box.width-NATIVE.width*scale)/2;
    const y = box.top-parent.top+(box.height-NATIVE.height*scale)/2;
    Object.assign(record.canvas.style, {
      left:(x+ROI.x*scale)+'px', top:(y+ROI.y*scale)+'px',
      width:(ROI.width*scale)+'px', height:(ROI.height*scale)+'px'
    });
  }

  function useFallback(record) {
    // Never clear a previously valid patch while a replacement frame decodes.
    if (record.valid) return true;
    const donor = records.find(other => other !== record && other.valid);
    if (!donor) return false;
    record.context.clearRect(0,0,ROI.width,ROI.height);
    record.context.drawImage(donor.canvas,0,0);
    record.valid = true;
    record.fallback = true;
    return true;
  }

  function render(record) {
    if (!available(record)) return useFallback(record);
    const sourceKey = record.source.currentSrc || record.source.src;
    if (record.source === poster && record.valid && !record.fallback && record.sourceKey === sourceKey) return true;
    const started = performance.now();
    try {
      read.clearRect(0,0,DONOR_WIDTH,2);
      read.drawImage(record.source,DONOR_X,TOP,DONOR_WIDTH,1,0,0,DONOR_WIDTH,1);
      read.drawImage(record.source,DONOR_X,BOTTOM,DONOR_WIDTH,1,0,1,DONOR_WIDTH,1);
      const donor = read.getImageData(0,0,DONOR_WIDTH,2).data;
      const output = record.image.data;
      for (let i=0; i<lookup.length; i++) {
        const p = lookup[i];
        const offset = i*4;
        for (let c=0; c<3; c++) {
          const top = donor[p.a0+c]*(1-p.af) + donor[p.a1+c]*p.af;
          const bottom = donor[p.b0+c]*(1-p.bf) + donor[p.b1+c]*p.bf;
          output[offset+c] = Math.round(top*(1-p.blend)+bottom*p.blend);
        }
        output[offset+3] = p.alpha;
      }
      record.context.putImageData(record.image,0,0);
      record.valid = true;
      record.fallback = false;
      record.sourceKey = sourceKey;
      record.renders++;
      record.sourceTime = record.source instanceof HTMLVideoElement ? record.source.currentTime : null;
      record.lastCostMs = performance.now()-started;
      record.maxCostMs = Math.max(record.maxCostMs,record.lastCostMs);
      record.error = null;
      completeReady(record);
      return true;
    } catch (error) {
      record.error = String(error && error.message || error);
      if (record.source === poster) failReady(error);
      return useFallback(record);
    }
  }

  function visible(record) {
    return record.source === poster || record.source.dataset.active === 'true';
  }

  function refresh() {
    // MutationObserver runs before paint. A decoded incoming slot receives its
    // own current patch before its data-active reveal reaches the screen.
    for (const record of records) {
      position(record);
      const active = visible(record);
      if (active) render(record);
      record.canvas.hidden = !active || !record.valid;
    }
  }

  function arm(record) {
    const video = record.source;
    if (!(video instanceof HTMLVideoElement) || record.frameRequest !== null || video.paused || video.ended) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      record.frameRequest = video.requestVideoFrameCallback(() => {
        record.frameRequest = null;
        if (visible(record)) {
          render(record);
          record.canvas.hidden = !record.valid;
        }
        arm(record);
      });
    } else {
      record.frameRequest = requestAnimationFrame(now => {
        record.frameRequest = null;
        if (visible(record) && now-(record.lastFallbackFrame||0)>=1000/24) {
          record.lastFallbackFrame = now;
          render(record);
          record.canvas.hidden = !record.valid;
        }
        arm(record);
      });
    }
  }

  for (const source of media) {
    const canvas = document.createElement('canvas');
    canvas.id = 'mark-cover-'+source.id;
    canvas.width = ROI.width;
    canvas.height = ROI.height;
    canvas.hidden = true;
    canvas.setAttribute('aria-hidden','true');
    canvas.dataset.markCoverFor = source.id;
    Object.assign(canvas.style, {position:'absolute',pointerEvents:'none',zIndex:source===poster?'1':'3'});
    scene.appendChild(canvas);
    const context = canvas.getContext('2d');
    if (!context) {
      if (source === poster) failReady(new Error('无法初始化静态地板标识遮盖画布'));
      continue;
    }
    const record = {source,canvas,context,image:context.createImageData(ROI.width,ROI.height),valid:false,fallback:false,renders:0,sourceTime:null,lastCostMs:0,maxCostMs:0,frameRequest:null,error:null};
    records.push(record);
    if (source instanceof HTMLVideoElement) {
      for (const event of ['loadeddata','seeked','pause','ended']) source.addEventListener(event,refresh);
      for (const event of ['play','playing']) source.addEventListener(event,() => {refresh();arm(record);});
    } else {
      source.addEventListener('load',refresh);
      source.addEventListener('error',() => failReady(new Error('无法读取初始房间图片')));
    }
  }

  const observer = new MutationObserver(refresh);
  for (const source of media) observer.observe(source,{attributes:true,attributeFilter:['src','data-active','style','class','hidden']});
  const resize = new ResizeObserver(refresh);
  resize.observe(scene);
  window.addEventListener('resize',refresh);
  document.addEventListener('visibilitychange',() => {
    if (document.visibilityState === 'visible') {refresh();records.forEach(arm);}
  });
  if (poster.complete && !poster.naturalWidth) failReady(new Error('无法读取初始房间图片'));
  refresh();
  records.forEach(arm);
})();
