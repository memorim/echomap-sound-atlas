import {test,expect} from '@playwright/test';
test('mobile layout and recovery after a failed API request',async({page})=>{
 await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();await expect(page.locator('.load-feedback')).toHaveText('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
 await page.route('**/api/sounds*',r=>r.fulfill({status:503,contentType:'application/json',body:'{"message":"Test unavailable"}'}));
 await page.reload();await expect(page.getByRole('button',{name:'Повторить загрузку',exact:true})).toBeVisible();
 await page.unroute('**/api/sounds*');await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await expect(page.locator('.load-feedback')).toHaveText('');
});

test('audio controls can stop, switch and play another recording',async({page})=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('.load-feedback')).toHaveText('');await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('■');await page.locator('.play').click();await page.locator('.next').click();await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('■');await page.locator('.play').click();expect(errors).toEqual([]);});

test('unavailable audio is reported without breaking the catalog',async({page})=>{
 await page.addInitScript(()=>{window.AudioContext=class {constructor(){throw new Error('Audio unavailable')}}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);await page.locator('.play').click();await expect(page.locator('#audio-status')).toContainText('Не удалось',{timeout:1000});expect(errors).toEqual([]);
});
test('every recording has an existing photographic cover',async({page})=>{
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);
 for(let i=0;i<8;i++){await page.locator('.next').click();await expect.poll(()=>page.locator('#cover-photo').evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:1000}).toBe(true);}
});

test('one AudioContext is reused and page exit closes it',async({page})=>{
 await page.addInitScript(()=>{const Native=window.AudioContext;window.audioCreated=0;window.AudioContext=class extends Native{constructor(...args){super(...args);window.audioCreated++;window.lastAudio=this;}}});
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);
 for(let i=0;i<4;i++){await page.locator('.play').click();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','true');await page.locator('.play').click();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','false');}
 expect(await page.evaluate(()=>audioCreated)).toBe(1);
 await expect.poll(()=>page.evaluate(()=>lastAudio.state)).toBe('suspended');
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));await expect.poll(()=>page.evaluate(()=>lastAudio.state)).toBe('closed');
});
test('a superseded delayed audio start cannot revive a previous selection',async({page})=>{
 await page.addInitScript(()=>{const Native=window.AudioContext;let held=false;window.AudioContext=class extends Native{resume(){const result=super.resume();if(!held){held=true;return new Promise(resolve=>window.releaseAudio=()=>result.then(resolve));}return result;}}});
 await page.goto('/');await expect(page.locator('.sound-row')).toHaveCount(8);await page.locator('.play').click();await expect(page.locator('.play')).toHaveText('…');await page.locator('.next').click();await page.evaluate(()=>window.releaseAudio());await expect(page.locator('.play')).toHaveAttribute('aria-pressed','false');
 await page.locator('.play').click();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','true');await page.locator('.play').click();
});
test('empty selection disables navigation and playback',async({page})=>{
 await page.route('**/api/sounds*',r=>r.fulfill({contentType:'application/json',body:'[]'}));await page.goto('/');await expect(page.locator('#title')).toHaveText('Нет записей');for(const selector of ['.play','.previous','.next'])await expect(page.locator(selector)).toBeDisabled();
});

test('keyboard selection retains focus on its recording control',async({page})=>{
 await page.goto('/');const button=page.locator('.sound-row button').first();await button.focus();await page.keyboard.press('Enter');await expect(button).toBeFocused();await expect(page.locator('.play')).toHaveAttribute('aria-pressed','true');await page.locator('.play').click();
});
