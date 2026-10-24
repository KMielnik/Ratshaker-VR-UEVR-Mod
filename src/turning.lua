-- Cooked CHAR look divides the shared axis by 15 only for bUsingGamepad.
-- The controller's MouseX/MouseY events can clear that flag between ticks.
-- Keep the classification coherent at the axis-to-look boundary; UEVR owns
-- snap rotation and the game still owns smooth look sensitivity.
local M={}
local function finite(v)
 return type(v)=="number" and v==v and v~=math.huge and v~=-math.huge
end
local function enabled(value)
 if type(value)=="boolean" then return value end
 if type(value)~="string" then return false end
 local clean=value:match("^[^%z]*"):lower():match("^%s*(.-)%s*$")
 return clean=="true" or clean=="1"
end
function M.new(env)
 local self={controller=nil,previous=nil,active=false}
 function self:snap_enabled()
  local ok,value=pcall(function() return env.uevr.params.vr:get_mod_value("VR_SnapTurn") end)
  return ok and enabled(value)
 end
 function self:pause()
  if self.controller and env.valid(self.controller) and self.previous~=nil then
   self.controller.bUsingGamepad=self.previous
  end
  self.controller,self.previous,self.active=nil,nil,false
 end
 function self:update(controller)
  if not env.valid(controller) then self:pause();return false end
  if self.controller and (not env.valid(self.controller) or
      self.controller:get_address()~=controller:get_address()) then self:pause() end
  if not self.controller then
   local previous=controller.bUsingGamepad
   -- Do not invent a reflected field on an unexpected controller class.
   if type(previous)~="boolean" then return false end
   self.controller,self.previous=controller,previous
  end
  self.active=true
  self.controller.bUsingGamepad=true
  return true
 end
 function self:guard(pawn)
  if not self.active or not env.valid(self.controller) or not env.valid(pawn) then return false end
  -- This runs in UpdateMouseAxisInputValues' posthook, before the native
  -- look branch reads bUsingGamepad. Property writes only: no ProcessEvent
  -- calls or hooks on functions invoked by the script itself.
  self.controller.bUsingGamepad=true
  if self:snap_enabled() or not finite(pawn.targetMouseInputAxisXValue) then
   pawn.targetMouseInputAxisXValue=0
  end
  pawn.targetMouseInputAxisYValue=0 -- HMD owns pitch.
  return true
 end
 function self:filter_xinput(state)
  if not self.active or not env.valid(self.controller) then return end
  -- UEVR 1.05's VR-controller snap path leaves RX live on the first
  -- threshold-crossing packet. Consume it here after UEVR has scheduled
  -- its snap, preventing an additional native smooth turn on that packet.
  if self:snap_enabled() then state.Gamepad.sThumbRX=0 end
  state.Gamepad.sThumbRY=0
 end
 self.cleanup=self.pause
 return self
end
return M
