-- Hide desktop mouse prompts in active VR. The native shake meter is untouched.
local M={}
function M.new(env)
 local valid,call=env.valid,env.call
 local self={widget=nil,saved=nil,status="Native HUD"}
 local function same(a,b)return valid(a)and valid(b)and a:get_address()==b:get_address()end
 function self:pause()
  if valid(self.widget) and self.saved then
   if self.saved.visibility~=nil then pcall(call,self.widget,"SetVisibility",self.saved.visibility) end
   if self.saved.opacity~=nil then pcall(call,self.widget,"SetRenderOpacity",self.saved.opacity) end
  end
  self.widget,self.saved=nil,nil;self.status="Native HUD"
 end
 function self:update(controller)
  if not valid(controller)then self:pause();return end
  local ok,hud=pcall(call,controller,"GetHUD")
  if not ok or not valid(hud)then self:pause();return end
  local got,widget=pcall(function()return hud.refInputList end)
  if not got or not valid(widget)then self:pause();return end
  if not same(widget,self.widget)then
   self:pause()
   local saved={}
   local v,value=pcall(call,widget,"GetVisibility")
   if v and type(value)=="number"then saved.visibility=value end
   local a,alpha=pcall(call,widget,"GetRenderOpacity")
   if a and type(alpha)=="number"then saved.opacity=alpha end
   self.widget,self.saved=widget,saved
  end
  if self.saved.visibility~=nil then call(widget,"SetVisibility",1)end
  if self.saved.opacity~=nil then call(widget,"SetRenderOpacity",0)end
  self.status="Native meter; mouse prompts hidden"
 end
 function self:cleanup()self:pause()end
 return self
end
return M
