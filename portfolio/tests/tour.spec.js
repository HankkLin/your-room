import { test, expect } from "@playwright/test";

for (const device of ["desktop","touch","keyboard"]) {
  test(device + " follows the masked original studio through checkout preview",async ({browser,baseURL},info) => {
    const touch=device==="touch";
    const context=await browser.newContext({baseURL,viewport:touch?{width:390,height:844}:{width:1440,height:1000},hasTouch:touch});
    const page=await context.newPage();
    const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    page.on("response",r=>{if(r.status()>=400) errors.push(r.url());});
    await page.route(/^https?:/,route=>{
      const url=route.request().url();
      if(!url.startsWith(baseURL)||url.includes("/api/")){errors.push(url);return route.abort();}
      return route.continue();
    });
    const guide=page.locator("#portfolio-guide");
    const next="#portfolio-note .guide-next";
    async function press(css,button=css) {
      await expect(guide).toHaveAttribute("data-target",css,{timeout:17000});
      const target=page.locator(button);
      if(device==="keyboard"){await expect(target).toBeFocused();await page.keyboard.press("Enter");}
      else if(touch) await target.tap({timeout:15000});
      else await target.click({timeout:15000});
    }
    try {
      await page.goto("./");
      await expect(page.getByRole("heading",{name:"Start with your home."})).toBeVisible();
      await expect(guide).toHaveAttribute("data-target","#try-sample-floorplan");
      const firstButton = page.locator("#try-sample-floorplan");
      await expect(firstButton).toHaveCSS("animation-name","guide-button-shine");
      await page.emulateMedia({reducedMotion:"reduce"});
      await expect(firstButton).toHaveCSS("animation-name","none");
      await expect(firstButton).not.toHaveCSS("box-shadow","none");
      await page.emulateMedia({reducedMotion:"no-preference"});
      await expect(guide.locator(".guide-controls")).toBeHidden();
      await page.locator("#custom-room").evaluate(el=>el.click());
      await expect(page.locator("#try-sample-floorplan")).toBeVisible();
      if(device==="desktop") await page.screenshot({path:info.outputPath("guided-original-frontend.png")});
      await expect(page.getByRole("button",{name:"Exit tour"})).toHaveCount(0);
      for(const css of ["#try-sample-floorplan","#fp-confirm-import","#load-family-of-four","#save-household","#setup-next",'[data-style="Soft modern"]']) await press(css);
      const rail = '[data-rail-candidate="sample-elm-stool"]';
      await expect(guide).toHaveAttribute("data-target",rail);
      if (device === "keyboard") await press(rail);
      else {
        const source = await page.locator(rail).boundingBox();
        const marker = await page.locator("#guide-drop-marker").boundingBox();
        const x = source.x + source.width/2, y = source.y + source.height/2;
        const dropX = marker.x + marker.width/2, dropY = marker.y + marker.height/2;
        if(touch) {
          const input = await context.newCDPSession(page);
          const send = (type,points) => input.send("Input.dispatchTouchEvent",{type,touchPoints:points});
          await send("touchStart",[{x,y}]);
          await send("touchMove",[{x:dropX,y:dropY}]);
          await expect(page.locator('.bp-drag-cursor-pill')).toHaveAttribute("data-drop-state","valid");
          await send("touchEnd",[]);
        } else {
          await page.locator(rail).click();
          await expect(guide).toHaveAttribute("data-target",rail);
          await page.mouse.move(x,y);
          await page.mouse.down();
          await page.mouse.move(dropX,dropY,{steps:12});
          await expect(page.locator('.bp-drag-cursor-pill')).toHaveAttribute("data-drop-state","valid");
          await page.screenshot({path:info.outputPath("furniture-drag.png")});
          await page.mouse.up();
        }
      }
      await press("#scene",next);
      await press("#tour-step");
      const placed = await page.evaluate(() => window.__livingBlueprint.getState().items.filter(i=>i.productId==="sample-elm-stool"));
      expect(placed).toHaveLength(1);
      expect(placed[0].roomId).toBe("living-room");
      if(device !== "keyboard") expect(Math.hypot(placed[0].x-4.65,placed[0].z-2.65)).toBeLessThan(.55);
      await press("#scene",next);
      if(await page.locator("#view-interior").isEnabled()){
        await press("#view-interior");
        await expect(guide).toHaveAttribute("data-controls","walk");
        await expect(guide.locator(".guide-controls kbd")).toHaveText(["W","S","A","D","Tab","Enter"]);
        const pin = room => page.locator(`#tour-map [data-spot="${room}"]`);
        for (const room of ["bedroom","kitchen"]) {
          if (touch) await pin(room).tap();
          else if (device === "keyboard") {
            const pinCount = await page.locator("#tour-map [data-spot]").count();
            for (let n=0;n<pinCount+2 && !(await pin(room).evaluate(el=>el===document.activeElement));n++) await page.keyboard.press("Tab");
            await expect(pin(room)).toBeFocused();
            await page.keyboard.press("Enter");
          } else await pin(room).click();
          await expect(page.locator("#scene")).toHaveAttribute("data-room",room);
        }
        const position = () => page.evaluate(() => {
          const {x,z}=window.__livingBlueprint.getScene().getPose();
          return [x,z];
        });
        if (!touch) {
          for (const key of ["w","s","a","d"]) {
            const [x,z] = await position();
            await page.keyboard.down(key);
            try {
              await expect.poll(async () => {
                const [nx,nz] = await position();
                return Math.hypot(nx-x,nz-z);
              }).toBeGreaterThan(.01);
            } finally {await page.keyboard.up(key);}
          }
        }
        await page.screenshot({path:info.outputPath("explore-controls.png")});
        if (device === "keyboard") {
          for (let n=0;n<10 && !(await page.locator(next).evaluate(el=>el===document.activeElement));n++) await page.keyboard.press("Tab");
        }
        await press("#scene",next);
        await expect(guide).toHaveAttribute("data-target","#stress-test-step");
        const positionAfterExplore = await position();
        await pin("bedroom").evaluate(el=>el.click());
        expect(await position()).toEqual(positionAfterExplore);
      }
      await press("#stress-test-step");
      const fixtures=()=>page.evaluate(()=>window.__livingBlueprint.getState().items.filter(i=>i.locked));
      const original=await fixtures();
      const ids = device === "keyboard" ? ["morning-routine"] : touch ? ["fire-emergency"] :
        ["friends-arrival","friends-arrival","fire-emergency","morning-routine","grandparents-visit"];
      async function choose(css, button) {
        await expect(guide).toHaveAttribute("data-target",css,{timeout:17000});
        if (device === "keyboard") {
          for (let i=0; i<10 && !(await page.locator(button).evaluate(el=>el===document.activeElement)); i++) await page.keyboard.press("Tab");
        }
        await press(css,button);
      }
      for (const [index,id] of ids.entries()) {
        if (!index) await expect(page.locator(".twin-scenario-grid [data-scenario-card]:visible")).toHaveCount(4);
        await choose(".twin-scenario-grid",'[data-scenario-card="'+id+'"]');
        if (!index) await choose("#sim-play-toggle",'.guide-speed button[value="1"]');
        await choose("#sim-play-toggle","#sim-play-toggle");
        if (!index) {
          await choose("#scene",'.guide-speed button[value="20"]');
          await expect(page.locator("#sim-speed-value")).toHaveAttribute("data-current-speed","20");
        }
        if (!index && device === "desktop") {
          await expect(guide).toHaveAttribute("data-target","#sim-findings-panel",{timeout:17000});
          await page.screenshot({path:info.outputPath("stress-test-results.png")});
        }
        await choose("#sim-findings-panel", index+1 < ids.length ? ".guide-again" : next);
      }
      const items=()=>page.evaluate(()=>window.__livingBlueprint.getState().items);
      const before=await items();
      await press("#sim-propose-redesign-btn");
      await press("#scene",next);
      expect(await items()).toEqual(before);
      await press("#sim-approve-redesign");
      if (ids.some(id=>id!=="morning-routine")) await press("#sim-redesign-outcome",next);
      await expect(guide.locator("tbody tr")).toHaveCount(new Set(["morning-routine",...ids]).size,{timeout:30000});
      const morning=guide.locator("tbody tr").first().locator("td");
      expect(parseFloat(await morning.nth(1).innerText())).toBeGreaterThan(0);
      await expect(morning.nth(2)).toHaveText("0s");
      expect(await fixtures()).toEqual(original);
      await press("#tray-review-products");
      await press("[data-guide-product]",next);
      await expect(guide).toContainText("$35.00");
      await press("[data-guide-product]",next);
      await expect(guide).toHaveAttribute("data-target","#try-sample-floorplan");
      expect(errors).toEqual([]);
    } finally {await context.close();}
  });
}

