-- Keep the native squeeze dispatcher adjacent to the hand trace. A native
-- camera trace later in the world tick must not replace its target in between.
-- No meter writes or direct actor interactions: the cooked player function
-- retains charge, rat-state, DoOnce, interface and story gates.
local M={interval=.3}
function M.new(env)
 local self={pawn=nil,active=false,first=false,remaining=M.interval,dispatches=0}
 local function finite(x)return type(x)=="number" and x==x and x>=0 and x<math.huge end
 function self:stop()
  if self.active and env.valid(self.pawn)then env.clear_timer(self.pawn)end
  self.pawn=nil;self.active=false;self.first=false;self.remaining=M.interval
 end
 function self:start(pawn)
  assert(env.valid(pawn),"Squeeze requires a valid pawn")
  self:stop()
  -- EnterRatSqueeze has just armed th_DrainWhenHeld. Cancel it before the
  -- engine timer manager gets a chance to run it against camera selection.
  local delay=M.interval
  if env.initial_delay then
   local ok,value=pcall(env.initial_delay,pawn)
   if ok and finite(value) then delay=value end
  end
  env.clear_timer(pawn)
  self.pawn=pawn;self.active=true;self.first=delay==0;self.remaining=delay
 end
 function self:step(dt)
  if not self.active then return false end
  if not env.valid(self.pawn)then self:stop();return false end
  if self.pawn.bRatSqueeze==false then self:stop();return false end
  if not finite(dt)then return false end
  -- Also catches the native input path rearming its timer while VR owns it.
  env.clear_timer(self.pawn)
  if not self.first then self.remaining=self.remaining-dt end
  if not self.first and self.remaining>1e-8 then return false end
  local first=self.first
  self.first=false
  if first then self.remaining=M.interval
  else self.remaining=M.interval-((-math.min(0,self.remaining))%M.interval) end
  -- Refresh and dispatch synchronously on the game thread. Never queue an
  -- actor pointer for a later native timer and never invoke from a hook.
  env.trace()
  env.call(self.pawn,"DrainShakeMeterWhenSqueezing")
  self.dispatches=self.dispatches+1
  if env.observe then env.observe(self.pawn,self.dispatches)end
  return true
 end
 self.cleanup=self.stop
 return self
end
return M
