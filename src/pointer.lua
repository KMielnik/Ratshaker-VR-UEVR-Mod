-- Left-hand interaction ray for the shipped RATSHAKER Blueprint.
-- Project the hand's landing point into the view, then keep the game's native
-- head-origin 300 cm/channel-2 selection policy. The perspective projection /
-- deprojection round trip is simply the ray from the head through that point;
-- it needs no desktop cursor, viewport size, or camera transform writes.
local Pointer = {}

local function finite(n) return type(n)=="number" and n==n and math.abs(n)<1e10 end
local function xyz(v)
 if v==nil then return nil end
 local x,y,z=v.x or v.X,v.y or v.Y,v.z or v.Z
 if not finite(x) or not finite(y) or not finite(z) then return nil end
 return {x=x,y=y,z=z}
end
local function add(a,b) return {x=a.x+b.x,y=a.y+b.y,z=a.z+b.z} end
local function sub(a,b) return {x=a.x-b.x,y=a.y-b.y,z=a.z-b.z} end
local function mul(a,k) return {x=a.x*k,y=a.y*k,z=a.z*k} end
local function len(a) return math.sqrt(a.x*a.x+a.y*a.y+a.z*a.z) end
local function norm(a) local l=len(a);if l<1e-7 then return nil end;return mul(a,1/l) end
local function output(t)
 -- UEVR 1.05 stores reflected out parameters under result. Accept index 1
 -- too so the adapter can be exercised against newer compatible bindings.
 if t.result~=nil then return t.result end
 return t[1]
end

function Pointer.new(env)
 assert(env and env.uevr and env.call and env.valid and env.IK,"Pointer requires the UEVR runtime adapter")
 local api,call,valid=env.uevr.api,env.call,env.valid
 local Q=env.IK.quaternion
 local s={pawn=nil,active=false,pointing=false,origin=nil,direction=nil,endpoint=nil,
  target=nil,hooks={},parts={},crosshair=nil,crosshair_opacity=nil,crosshair_visibility=nil,traces=0,
  progress=0,progress_known=false,progress_state="no target",visual_attempts=0,visual_retry_at=0,hud_errors={},
  range=env.pointer_range or 300,aim_range=env.pointer_aim_range or 1000,
  beam_width=env.pointer_width or .12,status="Waiting for left hand"}
 local self={state=s}
 local function log(t) if env.log then env.log("Left pointer: "..t) end end
 local function now() return env.now and env.now() or os.clock() end
 local function optional_hud(label,fn,...)
  local ok,err=pcall(fn,...)
  if not ok then
   local message=label..": "..tostring(err)
   if s.hud_errors[label]~=message then log("Optional HUD unavailable: "..message) end
   s.hud_errors[label]=message
   s.hud_error=message
  else s.hud_errors[label]=nil end
  return ok
 end
 local function same(a,b) return valid(a) and valid(b) and a:get_address()==b:get_address() end
 local function has(o,name) return valid(o) and o:get_class():find_function(name)~=nil end
 local function property(o,name)
  if not valid(o) then return nil end
  local ok,value=pcall(function() return o[name] end)
  return ok and value or nil
 end
 local function default(name)
  local c=api:find_uobject("Class /Script/"..name)
  assert(c~=nil,"Pointer class unavailable: "..name)
  return c:get_class_default_object()
 end
 local function library()
  s.system=s.system or default("Engine.KismetSystemLibrary")
  s.math=s.math or default("Engine.KismetMathLibrary")
  s.gameplay=s.gameplay or default("Engine.GameplayStatics")
  return s.system,s.math
 end
 local function vec(v)
  -- MakeVector returns a genuine reflected FVector. Arbitrary Lua tables are
  -- not accepted as UE5 FVector/FTransform parameters by UEVR 1.05.
  local _,mathlib=library()
  return call(mathlib,"MakeVector",v.x,v.y,v.z)
 end
 local function color(r,g,b,a)
  local _,mathlib=library()
  local name=has(mathlib,"MakeColor") and "MakeColor" or "MakeLinearColor"
  return call(mathlib,name,r,g,b,a or 1)
 end
 local function hud()
  if not valid(s.pawn) then return nil end
  local ok,o=pcall(function() return s.pawn.refHUD end)
  return ok and valid(o) and o or nil
 end
 local function restore_crosshair()
  if valid(s.crosshair) then
   if s.crosshair_opacity~=nil then pcall(call,s.crosshair,"SetRenderOpacity",s.crosshair_opacity) end
   if s.crosshair_visibility~=nil and has(s.crosshair,"SetVisibility") then
    pcall(call,s.crosshair,"SetVisibility",s.crosshair_visibility)
   end
  end
 end
 local function hide_crosshair()
  local h=hud();if not h then return end
  local ok,w=pcall(function() return h.refCrosshair end)
  if not ok or not valid(w) then return end
  if not same(s.crosshair,w) then
   restore_crosshair()
   s.crosshair=w
   local got,opacity=pcall(call,w,"GetRenderOpacity")
   s.crosshair_opacity=got and opacity or 1
   local got_visibility,visibility=pcall(call,w,"GetVisibility")
   if not got_visibility then
    got_visibility,visibility=pcall(function() return w.Visibility end)
   end
   s.crosshair_visibility=got_visibility and type(visibility)=="number" and visibility or nil
  end
  -- WBP_HeadsUpDisplay has latent animations that set root opacity back to 1.
  -- Collapsed is independent of those animations and removes hit testing too.
  -- Preserve the exact visibility enum; only use this guard if it can be saved.
  if s.crosshair_visibility~=nil and has(w,"SetVisibility") then call(w,"SetVisibility",1) end
  call(w,"SetRenderOpacity",0)
 end
 local function prompt(target)
  local h=hud()
  if h then
   if valid(target) and has(h,"ShowInteractPrompt") then call(h,"ShowInteractPrompt",target)
   elseif has(h,"HideInteractPrompt") then call(h,"HideInteractPrompt") end
  end
 end
 local function refresh_hud(target)
  -- Prompt animations/late HUD construction are optional presentation. Their
  -- failures must never abort the target update or right-hand native squeeze.
  local prompt_ok=optional_hud("prompt",prompt,target)
  local crosshair_ok=optional_hud("crosshair",hide_crosshair)
  if prompt_ok and crosshair_ok then s.hud_error=nil end
 end
 local function clear_target()
  s.target=nil
  s.progress=0;s.progress_known=false;s.progress_state="no target"
  if valid(s.pawn) then s.pawn.refValidInteractActor=nil;refresh_hud(nil) end
 end
 local function show(part,on)
  if valid(part) then
   if on and has(part,"SetHiddenInGame") then call(part,"SetHiddenInGame",false,false) end
   call(part,"SetVisibility",on,false)
  end
 end
 local function visible(on)
  for _,o in pairs(s.parts) do pcall(show,o,on) end
 end
 local function set_world(o,p,q,scale)
  if not valid(o) then return end
  local t=call(o,"K2_GetComponentToWorld")
  assert(env.write_transform,"Pointer visuals require write_transform")
  env.write_transform(t,{Translation=p,Rotation=q,Scale3D=scale})
  call(o,"K2_SetWorldTransform",t,false,{},true)
 end
 local identity={x=0,y=0,z=0,w=1}
 local function face_upright(direction)
  -- A shortest arc alone can roll the bar when looking across the opposite
  -- hemisphere. Yaw then pitch keeps its width horizontal and its top up.
  local yaw=math.atan(direction.y,direction.x)
  local pitch=math.atan(direction.z,math.sqrt(direction.x^2+direction.y^2))
  return Q.multiply({x=0,y=0,z=math.sin(yaw/2),w=math.cos(yaw/2)},
   {x=0,y=-math.sin(pitch/2),z=0,w=math.cos(pitch/2)})
 end
 local function feedback()
  s.progress=0;s.progress_known=false;s.progress_state="no target"
  if not valid(s.target) then return end
  local meter=property(s.pawn,"ACOMP_ShakeMeter")
  local units=property(meter,"TimeSqueezedUnits")
  local low=property(meter,"ShakeMeterMinValue")
  local high=property(meter,"ShakeMeterShakesToFill")
  local remaining=property(meter,"currentShakeMeterValue")
  if not finite(units) or not finite(low) or not finite(high) or high<=low or not finite(remaining) then
   s.progress_state="native charge unavailable";return
  end
  s.progress_known=true
  if property(s.pawn,"bRatDead")==true then s.progress_state="rat dead";return end
  if remaining<=0 then s.progress_state="empty";return end
  if property(s.pawn,"bRatSqueeze")~=true then s.progress_state="ready";return end
  -- Exact cooked WBP_HeadsUpDisplay InteractProgress calculation: convert
  -- TimeSqueezedUnits to capacity percent, then map 0..25 percent to 0..1.
  -- The separate native dispatch gate is >20%; a full bar is a charge display,
  -- never an assertion that an actor actually completed its interaction.
  local percent=math.max(0,math.min(1,(units-low)/(high-low)))*100
  s.progress=math.max(0,math.min(1,percent/25))
  s.progress_state="squeezing"
 end
 local function draw()
  local on=s.active and s.pointing and s.origin~=nil and s.direction~=nil
  if not on then visible(false);return end
  feedback()
  local selected=valid(s.target)
  show(s.parts.beam,true)
  show(s.parts.tip,not selected)
  show(s.parts.selected_tip,selected)
  show(s.parts.progress_track,selected and s.progress_known)
  show(s.parts.progress_fill,selected and s.progress_known and s.progress>0)
  local endpoint=s.endpoint or add(s.origin,mul(s.direction,s.range))
  local segment=sub(endpoint,s.origin);local length=len(segment)
  if length<.01 then visible(false);return end
  -- Engine cube dimensions are 100 cm. A slim solid beam and independent
  -- endpoint provide a binocular depth cue at the actual interaction target.
  local rotation=Q.shortest_arc({x=1,y=0,z=0},mul(segment,1/length))
  set_world(s.parts.beam,add(s.origin,mul(segment,.5)),rotation,
   {x=length/100,y=s.beam_width/100,z=s.beam_width/100})
  -- The packaged Engine sphere is 100 cm across. Small cream/amber dots leave
  -- the target readable; the larger dot means native interface acceptance.
  set_world(s.parts.tip,endpoint,identity,{x=.007,y=.007,z=.007})
  set_world(s.parts.selected_tip,endpoint,identity,{x=.013,y=.013,z=.013})
  if selected and s.progress_known then
   local facing=s.view_origin and norm(sub(s.view_origin,endpoint)) or mul(s.direction,-1)
   facing=facing or {x=1,y=0,z=0}
   local q=face_upright(facing)
   local function at(x,y,z) return add(endpoint,Q.rotate(q,{x=x,y=y,z=z})) end
   -- Real 10 cm world-space track. Its fill is anchored to the left edge;
   -- no timer advances this indicator when the native value is stationary.
   set_world(s.parts.progress_track,at(.6,0,-3),q,{x=.003,y=.104,z=.010})
   if s.progress>0 then
    local width=10*s.progress
    set_world(s.parts.progress_fill,at(.9,(10-width)/2,-3),q,{x=.002,y=width/100,z=.006})
   end
  end
 end
 local part_names={"beam","tip","selected_tip","progress_track","progress_fill"}
 local function release_component(o)
  local vs=env.visuals
  if vs and vs.forget_part then vs:forget_part(o) end
  pcall(show,o,false)
  local destroyed=true
  if valid(o) then destroyed=pcall(call,o,"K2_DestroyComponent",o) end
  -- Drop presentation references even if destruction fails. Retain the owned
  -- handle in that case so lifecycle cleanup can retry native destruction.
  for _,key in ipairs({"parts","owned"}) do
   local list=vs and vs[key]
   if type(list)=="table" and (key=="parts" or destroyed) then
    for i=#list,1,-1 do if list[i]==o then table.remove(list,i) end end
   end
  end
 end
 local function destroy_parts()
  for _,o in pairs(s.parts) do
   release_component(o)
  end
  s.parts={};s.visual_ready=false;s.visual_damage=false;s.health_check_at=nil
 end
 local function visuals_complete()
  if s.visual_damage then return false end
  for _,name in ipairs(part_names) do if not valid(s.parts[name]) then return false end end
  return true
 end
 local function draw_safely()
  if s.visual_damage then visible(false);return end
  local ok,err=pcall(draw)
  if not ok then
   visible(false);s.visual_damage=true
   local message=tostring(err)
   if s.visual_error~=message then log("Visual update failed; recovery queued: "..message) end
   s.visual_error=message
  end
 end
 local function visual_build()
  if not env.visuals or not valid(s.pawn) then return end
  local vs=env.visuals
  s.visual_stage="load cube"
  local mesh=vs:load_asset("/Engine/BasicShapes/Cube.Cube","StaticMesh")
  s.visual_stage="load sphere"
  local sphere=vs:load_asset("/Engine/BasicShapes/Sphere.Sphere","StaticMesh")
  s.visual_stage="load overlay material"
  local mat=vs:get_overlay_material()
  if not valid(mesh) or not valid(sphere) or not valid(mat) then error("Pointer cube/sphere/material unavailable") end
  local pose={Translation={x=0,y=0,z=0},Rotation=identity,Scale3D={x=.001,y=.001,z=.001}}
  -- Warm cream, amber and dark red echo the game's HUD. These are deliberate
  -- linear material colours, not claimed exact samples of its textured art.
  s.visual_stage="create pointer components"
  s.parts.beam=vs:make_part(s.pawn,nil,mesh,mat,"VR_LeftPointerBeam",pose,{r=.8,g=.62,b=.39,a=.55})
  s.parts.tip=vs:make_part(s.pawn,nil,sphere,mat,"VR_LeftPointerTarget",pose,{r=1,g=.82,b=.55,a=.9})
  s.parts.selected_tip=vs:make_part(s.pawn,nil,sphere,mat,"VR_LeftPointerSelectedTarget",pose,{r=1,g=.43,b=.055,a=1})
  s.parts.progress_track=vs:make_part(s.pawn,nil,mesh,mat,"VR_LeftPointerProgressTrack",pose,{r=.075,g=.009,b=.006,a=.95})
  s.parts.progress_fill=vs:make_part(s.pawn,nil,mesh,mat,"VR_LeftPointerProgressFill",pose,{r=1,g=.43,b=.055,a=1})
  assert(visuals_complete(),"Pointer component creation was incomplete")
  visible(false)
  log("Visible beam, small spherical markers and native squeeze-progress display created")
 end
 local function ensure_visuals()
  -- Only bind() and normal engine-tick trace() call this. Stereo updates must
  -- never load assets, destroy components or register replacement components.
  if not env.visuals or not valid(s.pawn) then return end
  if visuals_complete() then
   if env.visuals.part_healthy and (not s.health_check_at or now()>=s.health_check_at) then
    s.health_check_at=now()+1
    for _,name in ipairs(part_names) do
     local ok,healthy,reason=pcall(env.visuals.part_healthy,env.visuals,s.parts[name])
     if not ok or not healthy then
      s.visual_damage=true;s.visual_retry_at=0
      log("Visual health failed; rebuilding "..name..": "..tostring(ok and reason or healthy))
      break
     end
    end
   end
   if visuals_complete() then return end
  end
  if now()<s.visual_retry_at then return end
  destroy_parts()
  local vs=env.visuals
  local owned_start=type(vs.owned)=="table" and #vs.owned or nil
  s.visual_attempts=s.visual_attempts+1
  local ok,err=pcall(visual_build)
  if ok then
   s.visual_error=nil;s.visual_attempts=0;s.visual_retry_at=0;s.visual_ready=true
  else
   destroy_parts()
   -- make_part may throw after allocating a component but before returning
   -- it. Roll back that build's appended ownership entries as well.
   if owned_start then
    for i=#vs.owned,owned_start+1,-1 do
     release_component(vs.owned[i])
    end
   end
   local message=tostring(s.visual_stage or "setup")..": "..tostring(err)
   local delay=math.min(2,.5*2^math.min(s.visual_attempts-1,2))
   s.visual_retry_at=now()+delay
   if s.visual_error~=message or s.visual_attempts%15==0 then
    log("Visual creation failed (attempt "..s.visual_attempts..", retry in "..delay.."s): "..message)
   end
   s.visual_error=message
  end
 end
 local function line(start,endpoint)
  local system=library()
  local hit={}
  s.trace_color=s.trace_color or color(1,0,0,1)
  s.hit_color=s.hit_color or color(0,1,0,1)
  local blocked=call(system,"LineTraceSingle",s.pawn,vec(start),vec(endpoint),2,true,{},0,hit,true,
   s.trace_color,s.hit_color,0)
  s.traces=s.traces+1
  local result=output(hit)
  local actor,impact=nil,nil
  if blocked and result~=nil then
   local out={};for i=1,18 do out[i]={} end
   call(s.gameplay,"BreakHitResult",result,table.unpack(out))
   impact=xyz(output(out[6])) or xyz(output(out[5]))
   actor=output(out[10])
  end
  return blocked,result,actor,impact
 end
 local function selection_log(actor,reason)
  local address=valid(actor) and actor:get_address() or 0
  local key=tostring(address)..":"..reason
  if key==s.selection_log_key then return end
  s.selection_log_key=key
  local name=valid(actor) and tostring(address) or "none"
  if valid(actor) then
   local ok,value=pcall(function() return actor:get_full_name() end)
   if ok and value then name=tostring(value) end
  end
  local distance=s.view_origin and s.endpoint and len(sub(s.endpoint,s.view_origin)) or 0
  log("View selection: "..reason.."; actor="..name..string.format("; head distance=%.1f cm",distance))
  -- The VHS ejector is scenery; its separately colliding ChildActor owns the
  -- actual photo interaction. Diagnose that exact cooked relationship without
  -- selecting through the VHS housing or bypassing the ejection timeline.
  if name:find("ACT_VHS_EjectPhoto_C",1,true) then
   local ok,detail=pcall(function()
    local component=actor.ChildActor
    if not valid(component) then return "VHS photo child component unavailable" end
    local child=component.ChildActor
    if not valid(child) then return "VHS photo child unavailable (possibly collected)" end
    local local_pos=xyz(component.RelativeLocation)
    local message="VHS photo child="..tostring(child:get_full_name())
    if local_pos then message=message..string.format("; eject local=(%.1f,%.1f,%.1f)",local_pos.x,local_pos.y,local_pos.z) end
    local mesh=child.SM_PhotoPart
    if valid(mesh) and has(mesh,"K2_GetComponentLocation") then
     local world=xyz(call(mesh,"K2_GetComponentLocation"))
     if world then
      message=message..string.format("; photo world=(%.1f,%.1f,%.1f)",world.x,world.y,world.z)
      if s.endpoint then message=message..string.format("; photo-centre to blocked hit=%.1f cm",len(sub(world,s.endpoint))) end
      if s.selection_origin and s.selection_direction then
       local delta=sub(world,s.selection_origin);local d=s.selection_direction
       local along=delta.x*d.x+delta.y*d.y+delta.z*d.z
       local perpendicular=len(sub(delta,mul(d,along)))
       message=message..string.format("; centre off view ray=%.1f cm, along=%.1f cm",perpendicular,along)
      end
     end
     if has(mesh,"IsVisible") then message=message.."; mesh visible="..tostring(call(mesh,"IsVisible")) end
    end
    return message
   end)
   if ok then log(detail) else log("VHS photo child diagnostic unavailable: "..tostring(detail)) end
  end
 end
 function self:trace()
  if not valid(s.pawn) then return false end
  -- Do not consume a desktop camera target before the first tracked hand ray.
  if not s.active then clear_target();return false end
  ensure_visuals()
  if not s.pointing or not s.origin or not s.direction then
   clear_target();s.endpoint=nil;draw_safely();s.status="Left hand is not pointing";return false
  end
  if not s.view_origin then
   clear_target();s.endpoint=nil;draw_safely();s.status="Waiting for tracked head position";return false
  end
  local system=library()
  -- The long first ray only chooses where the finger lands. Selection still
  -- has the original 300 cm reach measured from the rendered HMD centre.
  local landing=add(s.origin,mul(s.direction,s.aim_range))
  local _,_,_,hand_impact=line(s.origin,landing)
  if hand_impact then landing=hand_impact end
  s.hand_landing=landing
  local direction=norm(sub(landing,s.view_origin))
  if not direction then
   clear_target();s.endpoint=landing;draw_safely();s.status="Pointer overlaps the view origin";return false
  end
  local start=s.view_origin
  local endpoint=add(start,mul(direction,s.range))
  s.selection_origin=start;s.selection_direction=direction
  -- The original InteractTrace uses TraceTypeQuery 2, trace complex, and
  -- bIgnoreSelf=true. It deliberately queries IsInteractable after collision.
  -- Trace only as far as the hand landing (+0.5 cm numerical tolerance), so
  -- a wall stopping the hand ray can never reveal an object behind that wall.
  local reach=math.min(s.range,len(sub(landing,start))+.5)
  endpoint=add(start,mul(direction,reach))
  local blocked,result,actor,impact=line(start,endpoint)
  if result~=nil then s.pawn.interactHitResult=result end
  local target=nil;s.endpoint=endpoint
  local reason="no collision within native reach"
  if blocked and result~=nil then
   if impact then s.endpoint=impact end
   reason="blocked by non-interactable collision"
   if valid(actor) then
    assert(s.interface~=nil,"The native interaction interface is unavailable")
    local implements=s.interface~=nil and call(system,"DoesImplementInterface",actor,s.interface)
    if implements and has(actor,"IsInteractable") then
     local allow={};call(actor,"IsInteractable",allow)
     if output(allow)==true then target=actor;reason="native interface accepted"
     else reason="native IsInteractable veto" end
    elseif implements then reason="native interface present, IsInteractable function missing"
    else reason="collision actor lacks native interaction interface" end
   end
  end
  s.target=target;s.pawn.refValidInteractActor=target
  s.hit_actor=actor;s.selection_reason=reason;s.selection_distance=len(sub(s.endpoint,start))
  s.hit_distance=len(sub(s.endpoint,s.origin))
  refresh_hud(target);draw_safely()
  selection_log(actor,reason)
  s.status=valid(target) and "View-projected left ray has an interactable target" or "View-projected left ray active"
  if s.visual_error then s.status=s.status.."; beam unavailable: "..s.visual_error end
  return valid(target)
 end
 function self:bind(pawn)
  if same(pawn,s.pawn) then ensure_visuals();return end
  self:cleanup();assert(valid(pawn),"Pointer requires a valid RATSHAKER pawn")
  s.pawn=pawn
  local cls=pawn:get_class();local key=cls:get_address()
  if not s.hooks[key] then
   local fn=cls:find_function("InteractTrace")
   assert(fn~=nil,"Native InteractTrace is missing")
   fn:hook_ptr(function(_,obj)
    if same(obj,s.pawn) and s.active then
     -- No reflected calls inside UFunction hooks: UEVR1.05's callback
     -- dispatcher is not reentrant. Normal engine ticks own the trace.
     return false -- suppress the original camera-sourced trace
    end
   end,nil)
   s.hooks[key]=true
  end
  s.interface=env.interface_class or api:find_uobject("BlueprintGeneratedClass /Game/Accessilogue/BLUEPRINT/Interfaces/BP_INT_InteractionInterface.BP_INT_InteractionInterface_C")
  assert(s.interface~=nil,"Native BP_INT_InteractionInterface class is missing")
  ensure_visuals()
  log("Bound native InteractTrace replacement")
 end
 function self:update(origin,direction,pointing,view_origin)
  origin,direction=xyz(origin),xyz(direction)
  direction=direction and norm(direction)
  if not origin or not direction or not valid(s.pawn) then self:pause();return false end
  s.active=true;s.origin=origin;s.direction=direction;s.pointing=pointing==true;s.view_origin=xyz(view_origin)
  s.endpoint=add(origin,mul(direction,s.hit_distance or s.range))
  -- A previous target is never retained after the left hand stops pointing.
  if not s.pointing then clear_target();s.endpoint=nil;s.hit_distance=nil end
  optional_hud("crosshair",hide_crosshair);draw_safely();return true
 end
 function self:pause()
  -- Clear only a target owned by this active ray. Repeated paused frames must
  -- leave the original desktop camera trace's newer selection untouched.
  if s.active or s.pointing or s.target~=nil then clear_target() end
  s.active=false;s.pointing=false;s.origin=nil;s.direction=nil;s.endpoint=nil;s.hit_distance=nil
  s.view_origin=nil;s.hand_landing=nil;s.selection_origin=nil;s.selection_direction=nil;s.selection_log_key=nil
  s.hit_actor=nil;s.selection_reason=nil;s.selection_distance=nil
  visible(false)
  optional_hud("restore crosshair",restore_crosshair)
  s.crosshair=nil;s.crosshair_opacity=nil;s.crosshair_visibility=nil
 end
 function self:cleanup()
  self:pause()
  destroy_parts();s.pawn=nil;s.target=nil
  s.visual_error=nil;s.visual_attempts=0;s.visual_retry_at=0
  s.hud_error=nil;s.hud_errors={}
  s.interface=nil;s.system=nil;s.math=nil;s.gameplay=nil;s.trace_color=nil;s.hit_color=nil
 end
 return self
end

return Pointer
