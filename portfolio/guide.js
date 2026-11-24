import "./guide.css";
import { SIMULATION_SPEEDS } from "../src/contracts/simulation.js";
import { measure, scenarios } from "./scenarios.js";
import { controlHints } from "./control-hints.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = el => el?.getClientRects().length && !el.disabled;
async function waitFor(check, message, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(message);
}

export function mountGuide({studio, dataset, restoreMorning, previewProposal, setView, stopWalking}) {
  const guide = document.createElement("div");
  guide.id = "portfolio-guide";
  guide.innerHTML = `<div id="portfolio-hole"></div><div id="portfolio-shield"></div><aside id="portfolio-note" aria-label="Portfolio guide">
    <strong></strong><p aria-live="polite"></p><ul class="guide-controls" aria-label="Available controls"></ul><div class="guide-speed" role="group" aria-label="Playback speed" hidden><span>Playback speed</span></div><div class="guide-results"></div><footer>
    <button class="secondary guide-again" hidden>Test another</button><button class="primary guide-next" hidden>Continue</button>
    </footer></aside>`;
  document.body.append(guide);
  const hole = guide.firstElementChild;
  const note = guide.querySelector("aside");
  const next = guide.querySelector(".guide-next");
  // A tap immediately after a furniture drag can lose its synthesized click.
  let tap;
  note.addEventListener("touchstart", event => {
    const button = event.target.closest("button");
    const point = event.touches[0];
    tap = button && event.touches.length === 1 ? {button, x:point.clientX, y:point.clientY} : null;
  }, {passive:true});
  note.addEventListener("touchcancel", () => { tap = null; });
  note.addEventListener("touchend", event => {
    const start = tap;
    tap = null;
    const point = event.changedTouches[0];
    if (!start || Math.hypot(point.clientX-start.x,point.clientY-start.y) > 8 ||
        !start.button.contains(document.elementFromPoint(point.clientX,point.clientY))) return;
    event.preventDefault();
    start.button.click();
  }, {passive:false});
  const again = note.querySelector(".guide-again");
  const speed = note.querySelector(".guide-speed");
  function syncSpeed() {
    for (const button of speed.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", Number(button.value) === studio.simulationUI.getState().speed);
    }
  }
  for (const multiplier of SIMULATION_SPEEDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.value = multiplier;
    button.textContent = multiplier + "×";
    button.onclick = () => { studio.simulationUI.selectSpeed(multiplier); syncSpeed(); };
    speed.append(button);
  }
  const cards = scenarios.map(([id]) => `[data-scenario-card="${id}"]`).join(",");
  note.tabIndex = -1;
  const dropMarker = document.createElement("span");
  dropMarker.id = "guide-drop-marker";
  dropMarker.textContent = "Drop stool here";
  dropMarker.hidden = true;
  guide.insertBefore(dropMarker, note);
  const results = guide.querySelector(".guide-results");
  let selector, allowTarget, clicked, target, frame;
  let mode, cuedTarget;
  function find() { return selector ? document.querySelector(selector) : null; }
  function place() {
    frame = 0;
    const dragging = !dropMarker.hidden;
    const current = find();
    const cue = allowTarget && ["action","place","choose"].includes(mode) ? current : null;
    if (cue !== cuedTarget) {
      cuedTarget?.removeAttribute("data-guide-cue");
      cue?.setAttribute("data-guide-cue", mode);
      cuedTarget = cue;
    }
    const rect = (dragging ? document.querySelector("#scene") : current)?.getBoundingClientRect();
    if (dragging) {
      const [x,z] = studio.getScene().projectFloorToScreen(4.65, 2.65);
      dropMarker.style.left = x + "px";
      dropMarker.style.top = z + "px";
    }
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    const padding = cue && !dragging ? 10 : 4;
    const left = Math.max(0, (rect?.left ?? width / 2) - padding);
    const top = Math.max(0, (rect?.top ?? height / 2) - padding);
    const right = Math.min(width, (rect?.right ?? left) + padding);
    const bottom = Math.min(height, (rect?.bottom ?? top) + padding);
    Object.assign(hole.style, {left:left+"px", top:top+"px", width:Math.max(0,right-left)+"px", height:Math.max(0,bottom-top)+"px"});
    guide.querySelector("#portfolio-shield").style.clipPath =
      `polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${left}px ${top}px,${right}px ${top}px,${right}px ${bottom}px,${left}px ${bottom}px,${left}px ${top}px)`;
    const w = note.offsetWidth, h = note.offsetHeight;
    let x = Math.min(Math.max(12,left),width-w-12), y;
    if (right+w+22 < width) { x = right+12; y = top; }
    else if (left > w+22) { x=left-w-12; y=top; }
    else y = bottom+h+20 < height ? bottom+10 : top-h-10;
    note.style.left = Math.max(8,x)+"px";
    note.style.top = Math.max(8,Math.min(y,height-h-8))+"px";
  }
  function layout() { if (!frame) frame=requestAnimationFrame(place); }
  window.addEventListener("scroll",layout,true);
  window.addEventListener("resize",layout);
  const sizeObserver = new ResizeObserver(layout);
  sizeObserver.observe(note);
  sizeObserver.observe(document.querySelector("#scene"));
  new MutationObserver(layout).observe(document.body,{childList:true,subtree:true});
  const pinSelector = "#tour-map [data-spot]";
  function permitted(node) {
    return note.contains(node) || (allowTarget && find()?.contains(node) && (mode !== "choose" || node.closest?.(cards))) ||
      (mode === "walk" && Boolean(node.closest?.(pinSelector)));
  }
  function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  for (const name of ["pointerdown","mousedown","touchstart","click","dblclick","contextmenu","dragstart","submit"]) {
    window.addEventListener(name,event => {
      if (!permitted(event.target)) return block(event);
      if (!dropMarker.hidden && name === "click" && event.detail > 0) return block(event);
      if (name === "click" && !note.contains(event.target) && clicked) {
        const done = clicked;
        clicked = null;
        const id = event.target.closest?.(cards)?.dataset.scenarioCard;
        setTimeout(() => done(id),0); // Let the original control commit its action first.
      }
    },{capture:true,passive:false});
  }
  window.addEventListener("keydown",event => {
    const active = document.activeElement;
    if (mode === "walk" && /^[wasd]$/i.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) return;
    if (event.key === "Tab") {
      block(event);
      const pins = mode === "walk" ? [...document.querySelectorAll(pinSelector)].filter(visible) : [];
      const targets = mode === "choose" ? [...document.querySelectorAll(cards)] : [allowTarget && find()];
      const list = [...targets, ...pins, ...note.querySelectorAll("button")].filter(Boolean).filter(visible);
      if (!list.length) return note.focus({preventScroll:true});
      const offset = event.shiftKey ? -1 : 1;
      list[(list.indexOf(active)+offset+list.length)%list.length].focus({preventScroll:true});
    } else if (!["Enter"," "].includes(event.key) || !permitted(active)) block(event);
  },true);
  let stage = "Floorplan";
  async function show(css, text, {interactive=false,button, title=stage, controls, playback=false, repeat=false} = {}) {
    delete guide.dataset.target;
    if (mode === "walk") stopWalking();
    mode = controls ?? (button ? "continue" : interactive ? "action" : "wait");
    guide.dataset.controls = mode;
    guide.querySelector(".guide-controls").innerHTML = controlHints(mode);
    document.body.classList.toggle("portfolio-camera-step", stage === "Explore room");
    clicked = null;
    allowTarget = false;
    selector = css;
    again.hidden = !repeat;
    speed.hidden = !playback;
    if (playback) syncSpeed();
    next.hidden = !button;
    next.textContent = button || "Continue";
    guide.querySelector("strong").textContent = title;
    guide.querySelector("p").textContent = text;
    place();
    target = await waitFor(() => visible(find()) && find(), "Could not locate the " + title + " control.");
    const focusArea = dropMarker.hidden ? target : document.querySelector("#scene");
    focusArea.scrollIntoView({block:"center",inline:"nearest",behavior:"instant"});
    if (!dropMarker.hidden) await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    allowTarget = interactive;
    (button ? next : mode === "choose" ? target.querySelector(cards) : interactive ? target : note).focus({preventScroll:true});
    place();
    guide.dataset.target = css;
  }
  async function action(css,text,options) {
    await show(css,text,{interactive:true,...options});
    return new Promise(resolve => { clicked = resolve; });
  }
  async function observe(css,text,button="Continue",interactive=false,controls) {
    await show(css,text,{interactive,button,controls});
    await new Promise(resolve => { next.onclick=resolve; });
    next.onclick=null;
  }
  async function complete(id) {
    await waitFor(() => {
      const s=studio.simulationUI.getState();
      if(s.status==="ERROR" || s.redesignStatus==="FAILED") throw new Error(s.errorMessage || s.redesignMessage || "Simulation failed.");
      return dataset()?.scenarioId===id && s.status==="COMPLETE";
    },"The simulation did not finish.", Infinity);
    return dataset();
  }
  async function tour() {
    await action("#try-sample-floorplan","Start the guided demo with the sample whole-home floorplan.");
    await action("#fp-confirm-import","Review the Mercer Street rooms, then confirm the floorplan.");
    stage="Household";
    await action("#load-family-of-four","Load Kevin, Alice, Leo, and Maya into the household editor.");
    await action("#save-household","Review the four schedules, then save the family.");
    stage="Furniture";
    await action("#setup-next","Keep the home’s existing furniture and continue.");
    stage="Your style";
    await action('[data-style="Soft modern"]',"Select Soft modern for the sample apartment.");
    const rail = '[data-rail-candidate="sample-elm-stool"]';
    document.body.classList.add("portfolio-placement");
    setView("plan");
    dropMarker.hidden = false;
    await show(rail, "Place the Mini Elm Wood Stool on the marked living-room floor.", {interactive:true, title:"Place furniture", controls:"place"});
    // A rejected or canceled drop leaves the visitor on this step for another try.
    while (!studio.getState().items.some(item => item.productId === "sample-elm-stool" && item.roomId === "living-room")) await delay(100);
    dropMarker.hidden = true;
    await observe("#scene","The stool is now in the living room. Continue to see the furnished home in 3D.");
    document.body.classList.remove("portfolio-placement");
    if (!document.querySelector("#view-3d").disabled) setView("3d");
    await action("#tour-step","Open Explore room to inspect the furnished home.");
    stage="Explore room";
    const orbit = !document.querySelector("#view-3d").disabled;
    await observe("#scene",orbit ? "Explore the apartment from above, then continue to eye level." : "Inspect the rooms in floorplan view.", "Continue", orbit, orbit ? "orbit" : "continue");
    if (!document.querySelector("#view-interior").disabled) {
      await action("#view-interior","Switch to eye level.");
      await observe("#scene","Explore at eye level for as long as you like. Choose Continue when you’re ready for the stress tests.", "Continue", true, "walk");
    }
    await action("#stress-test-step","Open the original stress-test controls.");
    const before = new Map();
    const morning = scenarios[0][0];
    stage = "Stress tests";
    studio.simulationUI.selectSpeed(20);
    let repeat;
    do {
      const id = await action(".twin-scenario-grid", "Choose Morning, Friends, Grandparents (wheelchair access), or Fire.", {controls:"choose"});
      const [,name,description] = scenarios.find(([key]) => key === id);
      if (id === "friends-arrival") studio.simulationUI.selectFriendCount(8);
      await action("#sim-play-toggle", description + " Press play to start.", {title:name,playback:true});
      await show("#scene", "Watching " + name + " on the original layout.", {title:name,playback:true});
      const run = await complete(id);
      before.set(id, run);
      await show("#sim-findings-panel", measure(run).detail + " Try another test or continue to the redesign.", {
        title:name + " results", button:"Continue to redesign", repeat:true,
      });
      repeat = await new Promise(resolve => {
        again.onclick = () => resolve(true);
        next.onclick = () => resolve(false);
      });
      again.onclick = next.onclick = null;
    } while (repeat);
    stage="Redesign";
    before.set(morning, restoreMorning(before.get(morning)));
    await action("#sim-propose-redesign-btn","Review a bundled sample Gemini response to kitchen congestion measured in the Morning test.");
    await waitFor(() => visible(document.querySelector("#sim-approve-redesign")),"The sample proposal did not pass validation.");
    previewProposal();
    await observe("#scene","Preview the proposed breakfast table and chair moves.", "Review changes");
    await action("#sim-approve-redesign","Approve the validated changes. The studio replays the morning.");
    await show("#scene","Replaying the morning on the approved layout.", {playback:true});
    const after = new Map([[morning, measure(await complete(morning))]]);
    const remaining = scenarios.filter(([id]) => id !== morning && before.has(id));
    stage="Compare";
    if (remaining.length) {
      await observe("#sim-redesign-outcome","The kitchen redesign has been tested. Replay your other selected tests on the new layout.", "Replay selected tests");
    }
    for (const [id,name] of remaining) {
      studio.demoHooks.runScenario(id,{friendCount:8});
      await show("#scene","Replaying " + name + " on the approved layout.", {playback:true});
      after.set(id, measure(await complete(id)));
    }
    const table=document.createElement("table");
    table.innerHTML="<thead><tr><th>Measure</th><th>Before</th><th>After</th></tr></thead>";
    const body=table.createTBody();
    after.forEach((row,id) => {
      const tr=body.insertRow();
      for(const value of [row.label,measure(before.get(id)).value+row.unit,row.value+row.unit]) tr.insertCell().textContent=value;
    });
    results.append(table);
    await action("#tray-review-products","Compare the results, then open the home’s shopping list.");
    results.replaceChildren();
    stage="Furnish & buy";
    const card = [...document.querySelectorAll(".shop-card")].find(el=>el.textContent.includes("Mini Elm Wood Stool"));
    if (!card) throw new Error("The saved stool is missing from the shopping list.");
    card.dataset.guideProduct="";
    await observe("[data-guide-product]","Sample shopping list · Review the stool you placed.", "Preview checkout");
    await observe("[data-guide-product]","Checkout preview · 1 Mini Elm Wood Stool · Olive Ateliers · $35.00 sample subtotal.", "Replay tour");
    location.reload();
  }
  tour().catch(error => {
    allowTarget=false;
    stopWalking();
    mode="continue";
    guide.querySelector(".guide-controls").innerHTML=controlHints(mode);
    guide.querySelector("strong").textContent="Guide paused";
    guide.querySelector("p").textContent=error.message;
    next.hidden=false;
    next.textContent="Restart tour";
    next.onclick=() => location.reload();
    place();
  });
}

