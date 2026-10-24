-- Integrated RATSHAKER VR adapter, bundled after IK/Motion/Rate/Gestures/Visuals/Pointer.
-- All game interaction calls run on engine tick; tracked visual updates run after
-- UEVR's native controller proxy conversion on the matching stereo eye.
local vr,hook=uevr.params.vr,UEVR_UObjectHook
local V,Q=IK.vector,IK.quaternion
local cfg={enabled=true,shoulder_width=36,shoulder_drop=19,shoulder_back=6,
 elbow_out=1,elbow_down=.55,max_stretch=1.03,
 left_pitch=0,left_yaw=0,left_roll=0,right_pitch=0,right_yaw=0,right_roll=0,
 left_x=0,left_y=0,left_z=0,right_x=0,right_y=0,right_z=0}
local S={pawn=nil,source=nil,visual=nil,rat=nil,proxies={},saved={},hooks={},active=false,
 time=0,dt=1/90,status="Waiting for VR",attempts=0,retry_at=0,release_pending=false,
 controls=nil,ray=nil,native_shake=false,native_grip=false,native_motion=false,
 total_ticks=0,errors={}}
local rate=Rate.new(Motion)
local hands=Gestures.new(IK,{capacitive_aliases=true})
local function log(message)
 message="[RatshakerVR] "..message
 print(message)
 pcall(function() uevr.params.functions.log_info((message:gsub("%%","%%%%"))) end)
end
local function valid(o) return o~=nil and hook.exists(o) end
local function same(a,b) return valid(a) and valid(b) and a:get_address()==b:get_address() end
local function call(o,name,...)
 assert(valid(o),"Invalid object for "..name)
 assert(o:get_class():find_function(name),"Missing reflected function "..name)
 return o[name](o,...)
end
local function optional(o,name,...)
 if not valid(o) or not o:get_class():find_function(name) then return nil end
 return call(o,name,...)
end
local function snapshot(t)
 return {Translation=V.read(t.Translation),Rotation=Q.normalize(t.Rotation),Scale3D=V.read(t.Scale3D)}
end
local function write_fields(target,value)
 for key,n in pairs(value) do
  key=key:lower();if target[key]==nil then key=key:upper() end
  target[key]=n
 end
end
local function write_transform(target,value)
 for _,field in ipairs({"Translation","Rotation","Scale3D"}) do
  local part=target[field];write_fields(part,value[field]);target[field]=part
 end
end
local function set_bone(mesh,name,value)
 local t=call(mesh,"GetBoneTransformByName",name,0)
 write_transform(t,value);call(mesh,"SetBoneTransformByName",name,t,0)
end
local function relative(child,parent)
 local s=parent.Scale3D
 assert(math.abs(s.x)>1e-7 and math.abs(s.y)>1e-7 and math.abs(s.z)>1e-7,"Invalid attachment scale")
 local p=Q.rotate(Q.inverse(parent.Rotation),V.sub(child.Translation,parent.Translation))
 return {Translation=V.new(p.x/s.x,p.y/s.y,p.z/s.z),
  Rotation=Q.multiply(Q.inverse(parent.Rotation),child.Rotation),
  Scale3D=V.new(child.Scale3D.x/s.x,child.Scale3D.y/s.y,child.Scale3D.z/s.z)}
end
local function default(name)
 local cls=uevr.api:find_uobject("Class /Script/"..name)
 assert(cls,"Required class unavailable: "..name)
 return cls:get_class_default_object()
end
local env={uevr=uevr,IK=IK,valid=valid,call=call,snapshot=snapshot,write_transform=write_transform,log=log,now=function()return S.time end}
local visuals=Visuals.new(env);env.visuals=visuals
local pointer=Pointer.new(env)
local hud=HUD.new(env)
local rendering=Rendering.new(env)
local turning=Turning.new(env)
local squeeze=Squeeze.new({valid=valid,call=call,
 initial_delay=function(pawn)
  local delay=call(default("Engine.KismetSystemLibrary"),"K2_GetTimerRemainingTimeHandle",pawn,pawn.th_DrainWhenHeld)
  log("Native squeeze timer remaining at takeover="..tostring(delay))
  return delay
 end,
 clear_timer=function(pawn)
  local timer=pawn.th_DrainWhenHeld
  assert(timer~=nil,"Native squeeze timer handle unavailable")
  call(default("Engine.KismetSystemLibrary"),"K2_ClearAndInvalidateTimerHandle",pawn,timer)
 end,
 trace=function()pointer:trace()end,
 observe=function(pawn,count)
  if count%3~=1 then return end
  local meter=pawn.ACOMP_ShakeMeter
  local target=pawn.refValidInteractActor
  log(string.format("Squeeze dispatch=%d target=%s units=%s capacity=%s remaining=%s ratDead=%s nativeSqueeze=%s",count,
   valid(target)and target:get_full_name()or"none",tostring(valid(meter)and meter.TimeSqueezedUnits),
   tostring(valid(meter)and meter.ShakeMeterShakesToFill),tostring(valid(meter)and meter.currentShakeMeterValue),
   tostring(pawn.bRatDead),tostring(pawn.bRatSqueeze)))
 end})
local palm_offsets={}
for side,reference in pairs(Gestures.reference) do
 palm_offsets[side]=IK.grip_basis_offset(reference.forward,reference.radial)
end
local calibration=Calibration.new({IK=IK,json=json,log=log})
calibration:load(palm_offsets)
local function error_once(scope,error)
 local message=tostring(error)
 if S.errors[scope]~=message then S.errors[scope]=message;log(scope..": "..message) end
 S.status=scope..": "..message
end
local function native_gate(active,strength)
 if not valid(S.pawn) then return end
 S.pawn.NewVar=active and -1 or 1e12
 S.pawn.mouseAxisShakeDetectThreshold=.01
 -- Native shake audio selects the strictly larger rounded mouse axis. Equal
 -- X/Y values enter neither volume branch, leaving both shake sounds muted.
 -- A single dominant axis preserves native volume/pitch and dialogue rules.
 local axis=active and (.35+.65*math.max(0,math.min(1,strength or 0))) or 0
 S.pawn.targetMouseInputAxisXValue=axis;S.pawn.targetMouseInputAxisYValue=0
end
local function shake_axis_owner(owned,active,strength)
 if owned then S.axis_owned=true;native_gate(active,strength)
 elseif S.axis_owned then native_gate(false,0);S.axis_owned=false end
end
local function rat_parent(parent,socket,pose)
 if not valid(S.rat) or not valid(parent) then return end
 if not same(call(S.rat,"GetAttachParent"),parent) then call(S.rat,"K2_AttachToComponent",parent,socket,0,0,0,false) end
 if pose then
  local native=call(S.rat,"K2_GetComponentToWorld");write_transform(native,pose)
  call(S.rat,"K2_SetRelativeTransform",native,false,{},true)
 end
end
local function clear_counter_timer()
 if not valid(S.pawn) then return end
 local timer=S.pawn.th_RatShakeCountIncrement
 assert(timer~=nil,"Native shake timer handle unavailable")
 call(default("Engine.KismetSystemLibrary"),"K2_ClearAndInvalidateTimerHandle",S.pawn,timer)
end
local function native_controls(mode,squeezing,moving)
 if not valid(S.pawn) then return end
 if not squeezing and S.native_grip then squeeze:stop();call(S.pawn,"ExitRatSqueeze");S.native_grip=false end
 if not moving and S.native_motion then call(S.pawn,"StopRatShakingMouseInput");S.native_motion=false end
 if not mode and S.native_shake then call(S.pawn,"ExitShakingMode");S.native_shake=false end
 if squeezing and not S.native_grip then
  -- Refresh the hand-directed target on the game thread before native squeeze
  -- timers invoke DrainShakeMeterWhenSqueezing/InteractWithUI.
  pointer:trace();call(S.pawn,"EnterRatSqueeze");S.native_grip=true;squeeze:start(S.pawn)
 end
 if mode and not S.native_shake then call(S.pawn,"EnterShakingMode");S.native_shake=true end
 if moving and not S.native_motion then
  call(S.pawn,"StartRatShakingMouseInput");clear_counter_timer();S.native_motion=true
 end
end
local function clear_input()
 local owned=S.rig_engaged or S.input_ready or S.native_shake or S.native_grip or S.native_motion
 pcall(native_controls,false,false,false)
 pcall(function()squeeze:stop()end)
 if owned then S.release_pending=true end
 shake_axis_owner(false,false,0);turning:pause()
 S.controls=nil;S.ray=nil;S.input_ready=false;rate:reset()
end
local function suppress_native_camera_shake()
 if not valid(S.pawn) then return end
 local shake=S.pawn.refShakeShake
 if not valid(shake) then return end
 local scale=shake.ShakeScale
 if type(scale)~="number" then return end
 S.saved.camera_shakes=S.saved.camera_shakes or {}
 local key=shake:get_address()
 if not S.saved.camera_shakes[key] then S.saved.camera_shakes[key]={object=shake,scale=scale} end
 shake.ShakeScale=0
end
local function pause_rig()
 pointer:pause();visuals:set_visible(false);hud:pause();rendering:pause()
 if valid(S.visual) then call(S.visual,"SetVisibility",false,false) end
 if S.tick_owned and valid(S.source) and S.saved.tick~=nil then S.source.VisibilityBasedAnimTickOption=S.saved.tick;S.tick_owned=false end
 S.active=false
 if not S.rig_engaged then return end
 if valid(S.source) and S.saved.visible~=nil then call(S.source,"SetVisibility",S.saved.visible,false) end
 if valid(S.saved.rat_parent) then rat_parent(S.saved.rat_parent,S.saved.rat_socket,S.saved.rat_relative) end
 if valid(S.pawn) then
  for key,value in pairs(S.saved.properties or {}) do pcall(function() S.pawn[key]=value end) end
 end
 for _,entry in pairs(S.saved.camera_shakes or {}) do
  if valid(entry.object) then pcall(function() entry.object.ShakeScale=entry.scale end) end
 end
 S.saved.camera_shakes=nil;S.rig_engaged=false
 if S.saved.headbob then pcall(function() S.saved.headbob.variable:set_int(S.saved.headbob.value) end);S.saved.headbob=nil end
end
local function cleanup()
 clear_input();pcall(pause_rig);pointer:cleanup();hud:cleanup();rendering:cleanup();visuals:cleanup();hands:reset()
 S.flat_visuals=false
 if S.rig_engaged and valid(S.pawn) then
  for key,value in pairs(S.saved.properties or {}) do pcall(function() S.pawn[key]=value end) end
 end
 if S.tick_owned and valid(S.source) and S.saved.tick~=nil then pcall(function() S.source.VisibilityBasedAnimTickOption=S.saved.tick end) end
 for _,p in pairs(S.proxies) do
  if valid(p) then hook.remove_motion_controller_state(p);pcall(call,p,"K2_DestroyComponent",p) end
 end
 if valid(S.visual) then pcall(call,S.visual,"K2_DestroyComponent",S.visual) end
 S.pawn,S.source,S.visual,S.rat=nil,nil,nil,nil
 S.world_head=nil
 S.proxies,S.saved={},{}
 S.native_shake,S.native_grip,S.native_motion=false,false,false
 S.rig_engaged,S.tick_owned=false,false
end
local function capture_native_state()
 local pawn=S.pawn
 S.saved.visible=call(S.source,"IsVisible")
 if not S.tick_owned then S.saved.tick=S.source.VisibilityBasedAnimTickOption end
 S.saved.properties={bHoldToShake=pawn.bHoldToShake,NewVar=pawn.NewVar,
  mouseAxisShakeDetectThreshold=pawn.mouseAxisShakeDetectThreshold,
  targetMouseInputAxisXValue=pawn.targetMouseInputAxisXValue,targetMouseInputAxisYValue=pawn.targetMouseInputAxisYValue}
 -- The cooked TriggerHeadBobCameraShake tests this CVar. Avoid hooking a
 -- function that could be reached by a Lua-initiated native transition.
 pcall(function()
  local variable=uevr.api:get_console_manager():find_variable("RS.HeadBob")
  if variable and not S.saved.headbob then S.saved.headbob={variable=variable,value=variable:get_int()} end
 end)
 if valid(S.rat) then
  S.saved.rat_parent=call(S.rat,"GetAttachParent");S.saved.rat_socket=call(S.rat,"GetAttachSocketName")
  local world=snapshot(call(S.rat,"K2_GetComponentToWorld"))
  if valid(S.saved.rat_parent) then S.saved.rat_relative=relative(world,snapshot(call(S.saved.rat_parent,"GetSocketTransform",S.saved.rat_socket,0))) end
  S.saved.rat_hand_relative=relative(world,snapshot(call(S.source,"GetSocketTransform","hand_r",0)))
 end
end
local function build(pawn,controller)
 cleanup();S.pawn=pawn;S.source=pawn.FirstPersonMesh;S.rat=pawn.Rat2D
 assert(valid(S.source),"FirstPersonMesh is unavailable")
 capture_native_state()
 hook.remove_motion_controller_state(S.source)
 local cls=uevr.api:find_uobject("Class /Script/Engine.PoseableMeshComponent")
 assert(cls,"PoseableMeshComponent unavailable")
 local base=call(S.source,"K2_GetComponentToWorld")
 S.visual=call(pawn,"AddComponentByClass",cls,true,base,false)
 call(S.visual,"SetSkinnedAssetAndUpdate",call(S.source,"GetSkeletalMeshAsset"),true)
 call(S.visual,"SetCollisionEnabled",0);call(S.visual,"SetGenerateOverlapEvents",false)
 call(S.visual,"SetCastShadow",false);call(S.visual,"SetOnlyOwnerSee",true)
 S.visual.BoundsScale=3;call(S.visual,"SetVisibility",false,false)
 for i=0,call(S.source,"GetNumMaterials")-1 do call(S.visual,"SetMaterial",i,call(S.source,"GetMaterial",i)) end
 call(S.visual,"CopyPoseFromSkeletalComponent",S.source)
 S.source.VisibilityBasedAnimTickOption=0;S.tick_owned=true
 local klass=pawn:get_class();local key=klass:get_address()
 if not S.hooks[key] then
  local axis=klass:find_function("UpdateMouseAxisInputValues");assert(axis,"Native mouse-axis bridge missing")
  axis:hook_ptr(nil,function(_,obj)
   if same(obj,S.pawn) and S.input_ready and cfg.enabled then
    turning:guard(obj)
    if S.native_shake then native_gate(S.motion and S.motion.active,S.motion and S.motion.strength) end
   end
  end)
  -- UEVR 1.05 holds a non-recursive callback lock. Hooking StartRatShaking-
  -- MouseInput (or its callees) and then invoking it from Lua deadlocks BEFORE
  -- the hook body runs. Clear its timer directly after the native call above;
  -- suppress UpdateRakShakeRageTimeline's ShakeScale on normal tick instead.
  S.hooks[key]=true
 end
 -- Establish visual ownership before the pointer borrows its factories.
 -- Otherwise the first visuals:update would treat this as a new pawn and
 -- destroy the pointer's freshly created beam during its ownership cleanup.
 visuals:update(pawn,controller,0)
 pointer:bind(pawn)
 log("Independent arm rig built; left ray replaces camera trace")
end
local function tracking_ready()
 if not cfg.enabled then return false,"Rig disabled" end
 if not vr.is_runtime_ready() or not vr.is_hmd_active() then return false,"VR/headset not active" end
 if not vr.is_using_controllers() then return false,"Controllers not active" end
 local l,r,h=vr.get_left_controller_index(),vr.get_right_controller_index(),vr.get_hmd_index()
 if l==nil or r==nil or l==-1 or r==-1 or l==4294967295 or r==4294967295 or l==h or r==h or l==r then return false,"Invalid controller indices" end
 if uevr.params.functions.is_drawing_ui() then return false,"UEVR menu open" end
 return true
end
local function raw_position(index)
 local p,q=UEVR_Vector3f.new(),UEVR_Quaternionf.new();vr.get_pose(index,p,q)
 -- Leave bad numeric samples for the detector to reject without tearing
 -- down both hands for one transient tracking sample.
 return {x=p.x or p.X,y=p.y or p.Y,z=p.z or p.Z}
end
local function raw_pose(index)
 local p,q=UEVR_Vector3f.new(),UEVR_Quaternionf.new();vr.get_pose(index,p,q)
 return {Translation=V.read(p),Rotation=Q.normalize(q),Scale3D=V.new(1,1,1)}
end
local function euler(pitch,yaw,roll)
 local p,y,r=math.rad(pitch)/2,math.rad(yaw)/2,math.rad(roll)/2
 return Q.multiply(Q.multiply({x=0,y=0,z=math.sin(y),w=math.cos(y)},
  {x=0,y=-math.sin(p),z=0,w=math.cos(p)}),{x=-math.sin(r),y=0,z=0,w=math.cos(r)})
end
uevr.sdk.callbacks.on_pre_engine_tick(function(_,dt)
 local finite=type(dt)=="number" and dt==dt and dt>0 and dt<1e5
 S.time=S.time+(finite and math.min(dt,1) or 0);S.dt=finite and math.min(dt,.1) or 0;S.squeeze_dt=finite and dt or 0
 local ok,err=pcall(function()
  S.flat_visuals=false
  local pawn=uevr.api:get_local_pawn(0)
  local controller=uevr.api:get_player_controller(0)
  if not valid(pawn) or not pawn:get_full_name():find("CHAR_RatshakerPlayer_C",1,true) then cleanup();return end
  if not valid(controller) then clear_input();pause_rig();return end
  local ready,reason=tracking_ready()
  calibration:poll(S.time,S.dt,ready and finite and not controller.bShowMouseCursor)
  if not ready or not finite or controller.bShowMouseCursor then
   clear_input();pause_rig();S.status=reason or "Menu/frame not ready"
   if S.wait_reason~=S.status then S.wait_reason=S.status;log("Waiting: "..S.status) end
   return
  end
  S.wait_reason=nil
  if not same(pawn,S.pawn) or not valid(S.visual) or not same(pawn.FirstPersonMesh,S.source) or not same(pawn.Rat2D,S.rat) then
   if not same(pawn,S.attempt_pawn) then S.attempt_pawn=pawn;S.attempts=0;S.retry_at=0 end
   if S.time<S.retry_at then return end
   S.attempts=S.attempts+1;build(pawn,controller)
  end
  local controls=hands:sample(vr)
  if not controls.right.ready then clear_input();pause_rig();S.status="Right trigger/grip unavailable";return end
  if not S.rig_engaged then capture_native_state() end
  S.controls=controls;S.input_ready=true;S.rig_engaged=true;pawn.bHoldToShake=true
  turning:update(controller)
  if S.saved.headbob then S.saved.headbob.variable:set_int(0) end
  S.source.VisibilityBasedAnimTickOption=0;S.tick_owned=true
  suppress_native_camera_shake()
  -- The pose is from the preceding stereo update, but the gesture is current.
  -- Releasing the left point must clear its target before a same-tick squeeze.
  if S.ray then
   pointer:update(S.ray.origin,S.ray.direction,controls.left.ready and controls.left.pointing and S.ray.pointing,S.world_head)
   pointer:trace()
  else pointer:pause() end
  local right=controls.right
  local motion=rate:step(raw_position(vr.get_right_controller_index()),dt,right.trigger,right.grip,true)
  S.motion=motion
  local can_shake=pawn.bCanRatShake~=false
  local can_squeeze=pawn.bCanRatSqueeze~=false
  shake_axis_owner(motion.mode and can_shake,motion.active and can_shake,motion.strength)
  native_controls(motion.mode and can_shake,motion.squeeze and can_squeeze,motion.active and can_shake)
  for i=1,(can_shake and motion.count or 0) do
   call(pawn,"IncrementShakeCounterAndDetectIfShaking");S.total_ticks=S.total_ticks+1
  end
  -- Pointer owns each marker's visibility. A blanket show would reveal both
  -- endpoints and empty progress parts between its engine/stereo updates.
  visuals:update(pawn,controller,dt)
  local presentation_ok,presentation_err=pcall(function()
   hud:update(controller)
   rendering:update(pawn,controller,dt)
  end)
  if not presentation_ok then error_once("Presentation update",presentation_err) end
  S.status=string.format("%s | %s | shake %.1f/s | %s",controls.left.gesture,controls.right.gesture,motion.rate,hud.status)
  if S.time-(S.last_log or -10)>2 then
   S.last_log=S.time
   local meter=valid(pawn.ACOMP_ShakeMeter) and pawn.ACOMP_ShakeMeter.currentShakeMeterValue or -1
   log(string.format("RT=%s grip=%s speed=%.3f accel=%.3f mode=%s active=%s ticks=%d meter=%s left=%s audioVol=%s audioPitch=%s axisX=%s axisY=%s",tostring(right.trigger),tostring(right.grip),motion.speed,motion.acceleration,tostring(motion.mode),tostring(motion.active),S.total_ticks,tostring(meter),controls.left.gesture,tostring(pawn.currentRatScreamVolumeMultiplier),tostring(pawn.currentRatScreamPitchMultiplier),tostring(pawn.targetMouseInputAxisXValue),tostring(pawn.targetMouseInputAxisYValue)))
  end
 end)
 if not ok then cleanup();S.retry_at=S.time+3;error_once("Runtime paused",err) end
end)
uevr.sdk.callbacks.on_post_engine_tick(function()
 local ok,err=pcall(function() visuals:post_update() end)
 if not ok then error_once("Flat visual update",err) end
 if S.input_ready then
  local ready,err=pcall(function()
   suppress_native_camera_shake()
   if S.native_shake then native_gate(S.motion and S.motion.active,S.motion and S.motion.strength) end
   if S.native_motion then clear_counter_timer() end
   local selected=pointer.state and pointer.state.target
   local actual=S.pawn.refValidInteractActor
   if (valid(selected) or valid(actual)) and not same(selected,actual) and S.time-(S.last_target_overwrite or -10)>1 then
    S.last_target_overwrite=S.time
    log("Target changed during native tick: hand="..(valid(selected)and selected:get_full_name()or"none")..
     " native="..(valid(actual)and actual:get_full_name()or"none"))
   end
   pointer:trace()
   if S.native_grip then squeeze:step(S.squeeze_dt)end
  end)
  if not ready then error_once("Post tick",err) end
 end
end)
local function update_arms(world_head,units)
 if not S.input_ready or not tracking_ready() or not valid(S.visual) or not S.controls then return end
 local raw_head=raw_pose(vr.get_hmd_index())
 local head=world_head.Translation
 S.world_head=head
 local tracked_hands={left=IK.tracked_world(raw_pose(vr.get_left_controller_index()),raw_head,world_head,units),
  right=IK.tracked_world(raw_pose(vr.get_right_controller_index()),raw_head,world_head,units)}
 if calibration:apply(tracked_hands,world_head.Rotation,Gestures.reference,palm_offsets) then
  for _,side in ipairs({"left","right"})do cfg[side.."_pitch"]=0;cfg[side.."_yaw"]=0;cfg[side.."_roll"]=0 end
 end
 local forward=V.normalize(V.read(call(S.pawn,"GetActorForwardVector")))
 local right=V.normalize(V.read(call(S.pawn,"GetActorRightVector")))
 local body=V.add(head,V.add(V.mul(forward,-cfg.shoulder_back),V.new(0,0,-cfg.shoulder_drop)))
 call(S.visual,"K2_SetWorldTransform",call(S.source,"K2_GetComponentToWorld"),false,{},true)
 -- Source remains animated/hidden for native game state. Reference hand
 -- descendants are seeded by Gestures once, never overwritten by CopyPose.
 for _,side in ipairs({"left","right"}) do
  local suffix=side=="left" and "l" or "r"
  local tracked=tracked_hands[side]
  local upper=snapshot(call(S.source,"GetSocketTransform","upperarm_"..suffix,0))
  local lower=snapshot(call(S.source,"GetSocketTransform","lowerarm_"..suffix,0))
  local hand=snapshot(call(S.source,"GetSocketTransform","hand_"..suffix,0))
  local clavicle=snapshot(call(S.source,"GetSocketTransform","clavicle_"..suffix,0))
  local sign=side=="left" and -1 or 1
  local shoulder=V.add(body,V.mul(right,sign*cfg.shoulder_width*.5));local shift=V.sub(shoulder,upper.Translation)
  upper.Translation=shoulder;lower.Translation=V.add(lower.Translation,shift);hand.Translation=V.add(hand.Translation,shift)
  local rotation=Q.multiply(Q.multiply(tracked.Rotation,euler(cfg[side.."_pitch"],cfg[side.."_yaw"],cfg[side.."_roll"])),palm_offsets[side])
  local target=V.add(tracked.Translation,Q.rotate(rotation,V.new(cfg[side.."_x"],cfg[side.."_y"],cfg[side.."_z"])))
  local plan=IK.solve(upper,lower,hand,target,{side=side,max_stretch=cfg.max_stretch,
   elbow_hint=V.add(V.mul(right,sign*cfg.elbow_out),V.new(0,0,-cfg.elbow_down)),hand_rotation=rotation})
  clavicle.Translation=V.add(clavicle.Translation,V.add(shift,plan.shoulder_shift))
  set_bone(S.visual,"clavicle_"..suffix,clavicle)
  set_bone(S.visual,"upperarm_"..suffix,plan.upper);set_bone(S.visual,"lowerarm_"..suffix,plan.lower);set_bone(S.visual,"hand_"..suffix,plan.hand)
  local actual=snapshot(call(S.visual,"GetBoneTransformByName","hand_"..suffix,0)).Translation
  S[side.."_wrist_error"]=V.length(V.sub(actual,target))
  S[side.."_reach"]=V.length(V.sub(target,head))
  local ray=hands:apply(side,plan.hand,S.controls[side],S.dt,function(name,t) set_bone(S.visual,name,t) end)
  if side=="left" then S.ray=ray;pointer:update(ray.origin,ray.direction,ray.pointing,head) end
 end
 rat_parent(S.visual,"hand_r",S.saved.rat_hand_relative)
 visuals:post_update()
 call(S.visual,"SetVisibility",true,false);call(S.source,"SetVisibility",false,false);S.active=true;S.attempts=0
 if S.time-(S.last_pose_log or -10)>2 then
  S.last_pose_log=S.time
  log(string.format("Wrist readback cm L=%.2f R=%.2f | hand-to-head cm L=%.1f R=%.1f | pointer=%s",
   S.left_wrist_error,S.right_wrist_error,S.left_reach,S.right_reach,pointer.state and pointer.state.status or "ready"))
 end
end
uevr.sdk.callbacks.on_post_calculate_stereo_view_offset(function(_,view_index,world_to_meters,position,rotation)
 if (view_index+1)%2~=0 then return end
 local ok,err=pcall(function()
  if not S.input_ready then return end
  assert(position and rotation,"Stereo camera pose unavailable")
  local r=V.read(rotation);local q=euler(r.x,r.y,r.z)
  local scale=tonumber(vr:get_mod_value("VR_WorldScale"):match("^[^%z]+")) or 1
  local units=(world_to_meters or 100)*scale
  local p=V.read(position)
  -- This UE5.4 game uses view indices 0/1. Remove the selected eye's
  -- separation to anchor wrists to the HMD center.
  if vr.get_eye_offset then
   local eye=UEVR_Vector3f.new();vr.get_eye_offset(view_index%2,eye)
   local e=V.read(eye);p=V.sub(p,Q.rotate(q,V.mul(V.new(-e.z,e.x,e.y),units)))
  end
  update_arms({Translation=p,Rotation=q,Scale3D=V.new(1,1,1)},units)
 end)
 if not ok then cleanup();S.retry_at=S.time+3;error_once("Arm update paused",err) end
end)
uevr.sdk.callbacks.on_xinput_get_state(function(_,index,state)
 if index~=vr.get_lowest_xinput_index() then return end
 if S.release_pending or (S.input_ready and cfg.enabled) then
  state.Gamepad.bRightTrigger=0;state.Gamepad.bLeftTrigger=0;S.release_pending=false
 end
 if S.input_ready and cfg.enabled then
  state.Gamepad.sThumbRY=0 -- physical HMD controls pitch; stick only turns the body
  turning:filter_xinput(state)
  if S.controls and S.controls.right.trigger then state.Gamepad.sThumbRX=0 end
 end
end)
uevr.sdk.callbacks.on_draw_ui(function()
 imgui.text("RATSHAKER VR")
 imgui.text(S.status)
 local changed,value=imgui.checkbox("Enable VR mod",cfg.enabled)
 if changed then cfg.enabled=value;if not value then cleanup() end end
 changed,value=imgui.checkbox("Quest/Index touch bindings",hands.capacitive_aliases)
 if changed then hands.capacitive_aliases=value end
 if imgui.button("Retry rig setup") then cleanup();S.attempts=0;S.retry_at=0 end
 if imgui.button("Calibrate wrist angles after closing menu") then calibration:request(3) end
 imgui.text(calibration.status)
 imgui.text("Left grip + index released: point; lift thumb: finger gun.")
 imgui.text("Right trigger + movement: shake. Right trigger + grip: squeeze.")
 for _,side in ipairs({"left","right"}) do
  for _,axis in ipairs({"pitch","yaw","roll"}) do
   local key=side.."_"..axis;changed,value=imgui.slider_float(key,cfg[key],-180,180);if changed then cfg[key]=value end
  end
  for _,axis in ipairs({"x","y","z"}) do
   local key=side.."_"..axis;changed,value=imgui.slider_float(key.." offset (cm)",cfg[key],-15,15);if changed then cfg[key]=value end
  end
 end
 changed,value=imgui.slider_float("Shake sensitivity (m/s)",rate.detector.cfg.min_speed,.12,1.2)
 if changed then rate.detector.cfg.min_speed=value end
 changed,value=imgui.slider_float("Visibility fill (0 = native lighting)",rendering.cfg.fill_strength,0,1)
 if changed then rendering:set_fill_strength(value) end
 imgui.text(pointer.state and pointer.state.status or "Left hand interaction ray")
 imgui.text(visuals.status)
 imgui.text(hud.status)
 imgui.text(rendering.status or "VR rendering controls")
end)
local desired_mod_values={VR_AimMethod="0",VR_DecoupledPitch="true",UI_FollowView="true",
 VR_MotionControlsInactivityTimer="86400",UObjectHook_AttachLerpEnabled="false",
 VR_RoomscaleMovement="false",VR_DPadShifting="false"}
local saved_mod_values={}
for key,value in pairs(desired_mod_values) do
 pcall(function() saved_mod_values[key]=vr:get_mod_value(key):match("^[^%z]+") end)
end
uevr.sdk.callbacks.on_script_reset(function()
 cleanup();rawset(_G,"RATSHAKER_VR_MOD_ACTIVE",nil)
 for key,value in pairs(saved_mod_values) do vr.set_mod_value(key,value) end
 log("Restored native meshes, properties, UI, attachments and materials")
end)
hook.activate()
for key,value in pairs(desired_mod_values) do vr.set_mod_value(key,value) end
log("Loaded integrated VR mod build="..tostring(RATSHAKER_VR_BUILD_ID or "unbundled-source").."; version="..tostring(RATSHAKER_VR_VERSION or "source"))
