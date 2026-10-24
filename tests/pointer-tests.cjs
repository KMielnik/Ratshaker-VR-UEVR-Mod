const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const fengari=require('fengari');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=fengari;
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(code){if(lauxlib.luaL_dostring(L,to_luastring(code))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
run(`
local next_id=0
function klass(methods)
 next_id=next_id+1;local address=next_id
 return {get_address=function()return address end,find_function=function(_,n)
  if methods[n] then return {hook_ptr=function(_,pre,post) methods[n].pre,methods[n].post=pre,post end} end
 end}
end
function object(methods)
 next_id=next_id+1;local address=next_id;local c=klass(methods or {})
 return setmetatable({alive=true,methods=methods or {},get_address=function()return address end,get_class=function()return c end},
 {__index=function(o,k)local f=o.methods[k];if f then return f.call or function()end end end})
end
function valid(o)return type(o)=='table' and o.alive==true end
reflected_calls=0
function invoke(o,name,...)reflected_calls=reflected_calls+1;assert(valid(o),'not a native object');assert(o[name],'not a reflected method: '..name);return o[name](o,...)end
local sink='result'
function outs(t,value)t[sink]=value end
function sinkmode(s)sink=s end
local trace=nil;local trace_history={}
system=object({LineTraceSingle={call=function(_,context,start,finish,channel,complex,ignored,debug,out,ignoreSelf,c1,c2,drawTime)
 assert(start.native=='FVector' and finish.native=='FVector' and c1.native=='FLinearColor' and c2.native=='FLinearColor','genuine native arguments')
 assert(channel==2 and complex==true and #ignored==0 and ignoreSelf==true and debug==0,'original collision semantics')
 trace={context=context,start=start,finish=finish};trace_history[#trace_history+1]=trace
 local actor,impact,block=hit_actor,hit_impact,blocking
 if trace_response then actor,impact,block=trace_response(start,finish,#trace_history) end
 outs(out,{native='FHitResult',actor=actor,impact=impact,traceStart=start,traceEnd=finish});return block
end},DoesImplementInterface={call=function(_,a,i)assert(i==interaction_class);return a.implements end}})
mathlib=object({MakeVector={call=function(_,x,y,z)return {x=x,y=y,z=z,native='FVector'}end},
 MakeColor={call=function(_,r,g,b,a)return {native='FLinearColor',R=r,G=g,B=b,A=a}end}})
gameplay=object({BreakHitResult={call=function(_,hit,...)
 assert(hit.native=='FHitResult');local p={...};assert(#p==18,'exact native BreakHitResult signature');outs(p[6],hit.impact);outs(p[10],hit.actor)
end}})
interaction_class=object({})
function class_of(cdo)return {get_class_default_object=function()return cdo end}end
api={find_uobject=function(_,name)
 if name=='Class /Script/Engine.KismetSystemLibrary' then return class_of(system) end
 if name=='Class /Script/Engine.KismetMathLibrary' then return class_of(mathlib) end
 if name=='Class /Script/Engine.GameplayStatics' then return class_of(gameplay) end
 if name=='BlueprintGeneratedClass /Game/Accessilogue/BLUEPRINT/Interfaces/BP_INT_InteractionInterface.BP_INT_InteractionInterface_C' then return interaction_class end
 error('Unexpected UObject path '..name)
end}
crosshair=object({GetRenderOpacity={call=function(o)return o.opacity end},SetRenderOpacity={call=function(o,v)o.opacity=v end},
 GetVisibility={call=function(o)return o.visibility end},SetVisibility={call=function(o,v)o.visibility=v end}});crosshair.opacity=.65;crosshair.visibility=4
hud=object({ShowInteractPrompt={call=function(o,a)o.prompt=a end},HideInteractPrompt={call=function(o)o.prompt=nil end}});hud.refCrosshair=crosshair
local hook={};pawn=object({InteractTrace=hook});pawn.refHUD=hud
meter=object({});pawn.ACOMP_ShakeMeter=meter
meter.TimeSqueezedUnits=0;meter.ShakeMeterMinValue=0;meter.ShakeMeterShakesToFill=40;meter.currentShakeMeterValue=30
pawn.bRatDead=false;pawn.bRatSqueeze=false
local cls=pawn:get_class();function cls:get_address()return 900 end
function current_hook()return hook.pre end
head_camera={position={x=123,y=456,z=789},rotation={x=0,y=0,z=0,w=1}};pawn.FirstPersonCamera=head_camera
door=object({IsInteractable={call=function(o,out)outs(out,o.allowed)end},InteractWithUI={call=function(o,key,mode)o.interacted=(o.interacted or 0)+1 end}})
door.implements=true;door.allowed=true
blocking=true;hit_actor=door;hit_impact={x=90,y=20,z=30}
visuals={parts={},owned={},load_attempts=0,material_attempts=0}
function visuals:load_asset(path)
 self.load_attempts=self.load_attempts+1
 if self.asset_fail then error('asset still streaming') end
 local asset=object({});asset.path=path;return asset
end
function visuals:get_overlay_material()
 self.material_attempts=self.material_attempts+1
 if self.material_fail then error('Overlay material is not translucent (BlendMode=0)') end
 return object({})
end
function visuals:make_part(p,parent,mesh,mat,name,pose,color)
 assert(parent==nil and p==pawn)
 local part=object({SetVisibility={call=function(o,on)o.visible=on end},
 SetHiddenInGame={call=function(o,on)o.hidden=on end},
 K2_GetComponentToWorld={call=function(o)return {}end},
 K2_SetWorldTransform={call=function(o,t)if o.draw_fail then error('component transform unavailable')end;o.transform=t end},
 K2_DestroyComponent={call=function(o)o.alive=false end}})
 part.name=name;part.color=color;part.mesh=mesh;self.parts[#self.parts+1]=part;self.owned[#self.owned+1]=part
 if self.part_fail==name then error('part setup failed after allocation') end
 return part
end
function visuals:part_healthy(part)return not part.lost_render_state,'render state lost' end
logs={}
test_time=0
env={uevr={api=api},call=invoke,valid=valid,visuals=visuals,log=function(message)logs[#logs+1]=message end,
 now=function()return test_time end,
 write_transform=function(t,v)for k,x in pairs(v)do t[k]=x end end}
function last_trace()return trace end
function all_traces()return trace_history end
function set_ray(pointer,origin,direction,pointing,head)return pointer:update(origin,direction,pointing,head or origin)end
function near(a,b)assert(math.abs(a-b)<1e-6,tostring(a)..' ~= '..tostring(b))end
`);
run(`env.IK=(function()\n${fs.readFileSync(path.join(SRC,'ik_math.lua'),'utf8')}\nend)()`);
run(`Pointer=(function()\n${fs.readFileSync(path.join(SRC,'pointer.lua'),'utf8')}\nend)()`);
run(`
p=Pointer.new(env);p:bind(pawn)
assert(current_hook()~=nil and #visuals.parts==5,'native trace hook plus five feedback components')
local parts=p.state.parts
for _,part in pairs(parts)do assert(not part.visible,'all pointer visuals start hidden')end
set_ray(p,{x=10,y=20,z=30},{x=2,y=0,z=0},true)
local before_hook=reflected_calls
assert(current_hook()(nil,pawn)==false,'the camera trace must be suppressed')
assert(last_trace()==nil and reflected_calls==before_hook,'UFunction hook must not invoke any reflected functions reentrantly')
p:trace()
local t=last_trace();assert(t.context==pawn);near(t.start.x,10);near(t.finish.x,90.5);near(t.finish.y,20);assert(#all_traces()==2,'landing plus native view trace')
assert(pawn.refValidInteractActor==door and hud.prompt==door,'native interaction target and HUD policy')
assert(pawn.interactHitResult.native=='FHitResult' and p.state.target==door)
assert(crosshair.opacity==0 and crosshair.visibility==1,'center-screen crosshair removed')
crosshair.opacity=1 -- native latent WBP animation resumes between mod updates
assert(crosshair.visibility==1,'native opacity animation cannot reveal the collapsed crosshair')
assert(parts.beam.visible and parts.selected_tip.visible and not parts.tip.visible,'accepted target changes the endpoint marker')
parts.beam.hidden=true;p:trace();assert(parts.beam.hidden==false,'death visibility flag was not repaired on owned pointer')
assert(parts.selected_tip.color.r>parts.selected_tip.color.g and parts.tip.color.g>parts.selected_tip.color.g,'amber selection is distinct from cream miss marker')
assert(parts.tip.mesh.path=='/Engine/BasicShapes/Sphere.Sphere' and parts.selected_tip.mesh.path==parts.tip.mesh.path,'both endpoint markers use the actual packaged sphere')
assert(parts.beam.mesh.path=='/Engine/BasicShapes/Cube.Cube' and parts.progress_track.mesh.path==parts.beam.mesh.path)
near(parts.tip.transform.Scale3D.x,.007);near(parts.selected_tip.transform.Scale3D.x,.013)
assert(parts.selected_tip.transform.Scale3D.x>parts.tip.transform.Scale3D.x,'selected marker is larger')
assert(parts.progress_track.visible and not parts.progress_fill.visible and p.state.progress_state=='ready','native idle charge is empty')
-- Read the native HUD values, with no independent timer or dispatch. The
-- native >20 percent interaction gate is distinct from 25 percent bar fill.
pawn.bRatSqueeze=true;meter.TimeSqueezedUnits=5;p:trace();near(p.state.progress,.5)
assert(parts.progress_fill.visible and parts.progress_fill.color.r>parts.progress_fill.color.g,'squeeze progress uses HUD amber')
assert(parts.progress_track.color.r>parts.progress_track.color.g*5,'progress track uses dark HUD red')
near(parts.progress_fill.transform.Scale3D.y,.05)
local saved_units,saved_remaining=meter.TimeSqueezedUnits,meter.currentShakeMeterValue
for i=1,6 do p:trace();near(p.state.progress,.5)end
assert(meter.TimeSqueezedUnits==saved_units and meter.currentShakeMeterValue==saved_remaining and door.interacted==nil,'feedback neither mutates charge nor dispatches interaction')
meter.TimeSqueezedUnits=8;p:trace();near(p.state.progress,.8)
meter.TimeSqueezedUnits=10;p:trace();near(p.state.progress,1)
assert(door.interacted==nil,'full display is not completion or interaction dispatch')
meter.TimeSqueezedUnits=80;p:trace();near(p.state.progress,1)
meter.TimeSqueezedUnits=-1;p:trace();near(p.state.progress,0);assert(not parts.progress_fill.visible)
meter.ShakeMeterMinValue=10;meter.ShakeMeterShakesToFill=50;meter.TimeSqueezedUnits=15
p:trace();near(p.state.progress,.5)
-- A partially filled bar is horizontal, faces the head, and keeps the same
-- left edge in several view directions, including the opposite hemisphere.
local sample_head={x=0,y=0,z=0}
local sample_hand={x=10,y=0,z=0}
for _,point in ipairs({{x=90,y=20,z=30},{x=-90,y=20,z=30},{x=20,y=-90,z=-30},{x=0,y=0,z=90}})do
 hit_impact=point;set_ray(p,sample_hand,{x=1,y=0,z=0},true,sample_head);p:trace()
 local track,fill=parts.progress_track.transform,parts.progress_fill.transform
 local right=env.IK.quaternion.rotate(track.Rotation,{x=0,y=1,z=0})
 local top=env.IK.quaternion.rotate(track.Rotation,{x=0,y=0,z=1})
 local normal=env.IK.quaternion.rotate(track.Rotation,{x=1,y=0,z=0})
 local distance=math.sqrt(point.x^2+point.y^2+point.z^2)
 near(right.z,0);assert(top.z>=-1e-6,'progress track remains upright')
 near(normal.x,-point.x/distance);near(normal.y,-point.y/distance);near(normal.z,-point.z/distance)
 local offset={x=fill.Translation.x-track.Translation.x,y=fill.Translation.y-track.Translation.y,z=fill.Translation.z-track.Translation.z}
 near(offset.x*right.x+offset.y*right.y+offset.z*right.z+fill.Scale3D.y*50,5)
end
-- Missing/nonfinite native data removes progress instead of fabricating it.
for _,field in ipairs({'TimeSqueezedUnits','ShakeMeterMinValue','ShakeMeterShakesToFill','currentShakeMeterValue'})do
 local saved=meter[field]
 for _,bad in ipairs({false,0/0,math.huge})do
  meter[field]=bad;p:trace();assert(not p.state.progress_known and not parts.progress_track.visible and not parts.progress_fill.visible)
  assert(parts.selected_tip.visible,'unknown progress must not erase a valid selection')
 end
 meter[field]=nil;p:trace();assert(not p.state.progress_known)
 meter[field]=saved
end
meter.ShakeMeterShakesToFill=10;p:trace();assert(not p.state.progress_known,'zero capacity fails closed')
meter.ShakeMeterShakesToFill=9;p:trace();assert(not p.state.progress_known,'reversed capacity fails closed')
meter.ShakeMeterShakesToFill=50
pawn.ACOMP_ShakeMeter=nil;p:trace();assert(not p.state.progress_known);pawn.ACOMP_ShakeMeter=meter
meter.alive=false;p:trace();assert(not p.state.progress_known);meter.alive=true
meter.currentShakeMeterValue=0;p:trace();near(p.state.progress,0);assert(p.state.progress_state=='empty' and not parts.progress_fill.visible)
meter.currentShakeMeterValue=30;pawn.bRatDead=true;p:trace();near(p.state.progress,0);assert(p.state.progress_state=='rat dead')
pawn.bRatDead=false;pawn.bRatSqueeze=false;p:trace();near(p.state.progress,0);assert(p.state.progress_state=='ready')
meter.ShakeMeterMinValue=0;meter.ShakeMeterShakesToFill=40;meter.TimeSqueezedUnits=0
hit_impact={x=90,y=20,z=30};set_ray(p,{x=10,y=20,z=30},{x=2,y=0,z=0},true);p:trace()
assert(pawn.FirstPersonCamera==head_camera);near(head_camera.position.x,123);near(head_camera.rotation.w,1)
invoke(pawn.refValidInteractActor,'InteractWithUI','',false);assert(door.interacted==1,'native squeeze resolves left ray target')
-- Moving only the camera must not change the interaction ray.
head_camera.position.x=-500;head_camera.rotation.w=-1;current_hook()(nil,pawn)
near(last_trace().start.x,10);near(last_trace().finish.x,90.5)
-- A hand landing point selects through the rendered view, without moving the
-- real camera. The view ray is projection/deprojection equivalent and uses
-- native head distance, not controller distance.
local head={x=0,y=0,z=160};local hand={x=40,y=30,z=120}
hit_impact={x=200,y=30,z=120}
set_ray(p,hand,{x=1,y=0,z=0},true,head);assert(p:trace())
local view=last_trace();near(view.start.x,0);near(view.start.z,160)
local toward={x=hit_impact.x-head.x,y=hit_impact.y-head.y,z=hit_impact.z-head.z}
local length=math.sqrt(toward.x^2+toward.y^2+toward.z^2)
near(view.finish.x,toward.x*(length+.5)/length)
near(view.finish.y,toward.y*(length+.5)/length)
assert(pawn.interactHitResult.traceStart.z==160,'native hit data must come from the view ray')
-- The target plane can be beyond hand reach but remains limited to 300 cm
-- from the head; no extra range is granted by an outstretched controller.
hit_impact={x=900,y=30,z=120};p:trace()
view=last_trace();near(math.sqrt((view.finish.x-head.x)^2+(view.finish.y-head.y)^2+(view.finish.z-head.z)^2),300)
-- Same 2D landing point, different source: the small photo is hit by the
-- view ray although the hand ray landed on its supporting surface.
photo=object({IsInteractable={call=function(o,out)outs(out,true)end},InteractWithUI={call=function(o)o.picked=true end}})
photo.implements=true
wall=object({});wall.implements=false
trace_response=function(start,finish)
 if start.z==120 then return wall,{x=200,y=30,z=120},true end
 return photo,{x=196,y=29.4,z=120.8},true
end
set_ray(p,hand,{x=1,y=0,z=0},true,head);assert(p:trace() and pawn.refValidInteractActor==photo)
invoke(pawn.refValidInteractActor,'InteractWithUI','',false);assert(photo.picked,'photo uses native actor interaction')
-- A wall in front of the projected target wins. No interface filtering is
-- applied to collision before choosing the closest hit.
trace_response=function(start,finish)return wall,{x=80,y=12,z=144},true end
p:trace();assert(pawn.refValidInteractActor==nil and p.state.endpoint.x==80,'wall occlusion is retained')
assert(parts.tip.visible and not parts.selected_tip.visible and not parts.progress_track.visible and not parts.progress_fill.visible,'wall or lost target clears selection and progress feedback')
assert(p.state.progress==0 and not p.state.progress_known)
-- A non-interactable VHS carrier must not be silently redirected to its
-- photo child. Keep diagnostics distinct from a missing reflected method.
carrier=object({});carrier.implements=false
function carrier:get_full_name()return 'ACT_VHS_EjectPhoto_C /Game/House.StaticMeshActor_10'end
carrier.ChildActor=object({});carrier.ChildActor.RelativeLocation={x=12,y=10,z=7}
carrier.ChildActor.ChildActor=photo
function photo:get_full_name()return 'ACT_PhotoPiece_C /Game/House.ChildPhoto'end
photo.SM_PhotoPart=object({K2_GetComponentLocation={call=function()return {x=185,y=10,z=120}end},IsVisible={call=function()return true end}})
trace_response=function()return carrier,{x=185,y=0,z=120},true end
p:trace();assert(pawn.refValidInteractActor==nil and p.state.selection_reason=='collision actor lacks native interaction interface')
assert(logs[#logs]:find('VHS photo child=ACT_PhotoPiece_C',1,true) and logs[#logs]:find('eject local=(12.0,10.0,7.0)',1,true))
assert(logs[#logs]:find('photo world=(185.0,10.0,120.0)',1,true) and logs[#logs]:find('centre off view ray=',1,true) and logs[#logs]:find('mesh visible=true',1,true),'photo visibility and projection diagnostics')
local missing_method=object({});missing_method.implements=true
trace_response=function()return missing_method,{x=185,y=0,z=120},true end
p:trace();assert(pawn.refValidInteractActor==nil and p.state.selection_reason=='native interface present, IsInteractable function missing')

-- Before a valid rendered head sample exists, fail closed instead of using
-- the flat camera component's stale position or a retained desktop target.
p:update(hand,{x=1,y=0,z=0},true,nil);assert(not p:trace() and pawn.refValidInteractActor==nil)
trace_response=nil;hit_impact={x=90,y=20,z=30}

-- A different pointing direction comes exclusively from the left hand.
set_ray(p,{x=-20,y=-40,z=70},{x=0,y=1,z=0},true);p:trace()
near(last_trace().start.x,-20);near(all_traces()[#all_traces()-1].finish.y,960)
door.allowed=false;p:trace();assert(pawn.refValidInteractActor==nil and hud.prompt==nil,'native IsInteractable veto retained')
door.allowed=true;door.implements=false;p:trace();assert(pawn.refValidInteractActor==nil,'interface check retained')
door.implements=true;blocking=false;p:trace();assert(pawn.refValidInteractActor==nil,'empty ray clears target')
blocking=true;p:trace();assert(pawn.refValidInteractActor==door)
set_ray(p,{x=0,y=0,z=0},{x=1,y=0,z=0},false)
assert(pawn.refValidInteractActor==nil and not visuals.parts[1].visible,'open palm/fist removes pointer and interaction')
assert(current_hook()(nil,pawn)==false,'head trace stays disabled when left gesture is not pointing')
assert(pawn.refValidInteractActor==nil)
-- Both known output table representations are supported.
sinkmode(1);set_ray(p,{x=0,y=0,z=0},{x=1,y=0,z=0},true);assert(p:trace() and pawn.refValidInteractActor==door)
-- Pausing restores the original HUD and permits normal non-VR behavior.
p:pause();assert(crosshair.opacity==.65 and crosshair.visibility==4 and current_hook()(nil,pawn)==nil,'exact native opacity/visibility restored')
assert(not visuals.parts[1].visible and pawn.refValidInteractActor==nil)
for _,part in pairs(parts)do assert(not part.visible,'pause hides every feedback component')end
assert(p.state.progress==0 and not p.state.progress_known)
pawn.refValidInteractActor=door;p:pause();assert(pawn.refValidInteractActor==door,'paused ray cleared a newer native desktop selection')
assert(not p:trace() and pawn.refValidInteractActor==nil,'first tracked squeeze consumed a desktop target without a hand ray')
-- Invalid tracking data never leaves a selectable stale target.
set_ray(p,{x=0,y=0,z=0},{x=1,y=0,z=0},true);p:trace()
set_ray(p,{x=0/0,y=0,z=0},{x=1,y=0,z=0},true);assert(not p.state.active and pawn.refValidInteractActor==nil)
set_ray(p,{x=0,y=0,z=0},{x=0,y=0,z=0},true);assert(not p.state.active)
p:cleanup();for _,part in pairs(parts)do assert(not part.alive,'all owned feedback meshes destroyed')end
assert(pawn.refValidInteractActor==nil and current_hook()(nil,pawn)==nil,'cleanup disables hooks')
-- Older/narrower metadata may omit native visibility methods. The opacity
-- fallback must remain usable, and must not invent a visibility value.
crosshair.methods.GetVisibility=nil;crosshair.methods.SetVisibility=nil
fallback=Pointer.new(env);fallback:bind(pawn)
set_ray(fallback,{x=0,y=0,z=0},{x=1,y=0,z=0},true);fallback:trace()
assert(crosshair.opacity==0 and crosshair.visibility==4,'optional visibility metadata fallback')
fallback:cleanup();assert(crosshair.opacity==.65 and crosshair.visibility==4)
-- Restart/streaming can temporarily reject the material. Selection remains
-- usable, retry work is bounded in frequency, and no death/rebind is needed.
visuals.material_fail=true
local material_before=visuals.material_attempts
recovery=Pointer.new(env);recovery:bind(pawn)
assert(recovery.state.visual_error and next(recovery.state.parts)==nil)
local failure_logs=#logs
set_ray(recovery,{x=0,y=0,z=0},{x=1,y=0,z=0},true)
for i=1,20 do assert(recovery:trace() and pawn.refValidInteractActor==door) end
assert(visuals.material_attempts==material_before+1,'no per-frame creation retries')
local first_retry=recovery.state.visual_retry_at;near(first_retry,.5)
test_time=first_retry
local loads_before=visuals.load_attempts
set_ray(recovery,{x=0,y=0,z=0},{x=1,y=0,z=0},true)
assert(visuals.load_attempts==loads_before,'stereo-facing update must not load assets')
for i=1,12 do
 test_time=recovery.state.visual_retry_at
 assert(recovery:trace())
 assert(recovery.state.visual_retry_at-test_time<=30,'retry delay is capped at 30 seconds')
end
assert(visuals.material_attempts==material_before+13,'long streaming waits never permanently disable recovery')
local error_logs=0
for i=failure_logs+1,#logs do if logs[i]:find('Visual creation failed',1,true) then error_logs=error_logs+1 end end
assert(error_logs==0,'an unchanged creation error is not logged on each retry')
visuals.material_fail=false;test_time=recovery.state.visual_retry_at
recovery:trace()
assert(recovery.state.visual_ready and recovery.state.visual_error==nil and not recovery.state.status:find('unavailable',1,true),'successful retry clears stale error/status')
local recovered_parts=recovery.state.parts
-- Losing one component while retaining the same pawn repairs all five.
recovered_parts.tip.alive=false
recovery:trace()
assert(recovery.state.parts~=recovered_parts and recovery.state.parts.tip.alive and recovery.state.visual_error==nil)
for _,part in pairs(recovered_parts)do assert(not part.alive,'replaced components must be destroyed')end
-- Any partial make_part failure, including allocation before it throws, is
-- rolled back. No invisible orphan survives in the shared owned list.
local previous=recovery.state.parts
previous.beam.alive=false;visuals.part_fail='VR_LeftPointerSelectedTarget'
local owned_before=#visuals.owned;local created_before=#visuals.parts
assert(recovery:trace() and recovery.state.visual_error)
assert(next(recovery.state.parts)==nil and #visuals.owned==owned_before-5,'partial-build ownership rollback')
for i=created_before+1,#visuals.parts do assert(not visuals.parts[i].alive,'failed-build component leaked')end
visuals.part_fail=nil;test_time=recovery.state.visual_retry_at
recovery:bind(pawn)
assert(recovery.state.visual_ready and recovery.state.visual_error==nil,'same-pawn bind also services due recovery')
-- Visual transform failures cannot interrupt ray selection or escape through
-- the stereo callback; the next normal tick replaces the damaged visuals.
local broken=recovery.state.parts.beam;broken.draw_fail=true
assert(set_ray(recovery,{x=0,y=0,z=0},{x=1,y=0,z=0},true))
assert(recovery.state.visual_damage and recovery.state.visual_error)
assert(recovery:trace() and not broken.alive and recovery.state.visual_error==nil)
-- Both late HUD arrival and exceptions in optional HUD calls preserve the
-- native target. A replacement crosshair is acquired without pawn rebinding.
pawn.refHUD=nil;assert(recovery:trace() and pawn.refValidInteractActor==door)
pawn.refHUD=hud
local saved_show=hud.methods.ShowInteractPrompt.call
local saved_opacity=crosshair.methods.SetRenderOpacity.call
hud.methods.ShowInteractPrompt.call=function()error('HUD still constructing')end
crosshair.methods.SetRenderOpacity.call=function()error('crosshair still constructing')end
assert(recovery:trace() and recovery.state.hud_error and pawn.refValidInteractActor==door)
set_ray(recovery,{x=0,y=0,z=0},{x=1,y=0,z=0},false)
assert(pawn.refValidInteractActor==nil,'HUD failure cannot retain a stale target')
hud.methods.ShowInteractPrompt.call=saved_show;crosshair.methods.SetRenderOpacity.call=saved_opacity
set_ray(recovery,{x=0,y=0,z=0},{x=1,y=0,z=0},true);assert(recovery:trace() and recovery.state.hud_error==nil)
local old_crosshair=crosshair
crosshair=object({GetRenderOpacity={call=function(o)return o.opacity end},SetRenderOpacity={call=function(o,v)o.opacity=v end},
 GetVisibility={call=function(o)return o.visibility end},SetVisibility={call=function(o,v)o.visibility=v end}})
crosshair.opacity=.3;crosshair.visibility=2;hud.refCrosshair=crosshair
assert(recovery:trace() and crosshair.opacity==0 and crosshair.visibility==1 and old_crosshair.opacity==.65)
-- Respawn binds the new pawn, clears the last episode's failure, and restores
-- the previous HUD. Asset failures on the new pawn also retry successfully.
local old_pawn=pawn;local old_parts=recovery.state.parts
local new_hook={};pawn=object({InteractTrace=new_hook});pawn.refHUD=hud;pawn.ACOMP_ShakeMeter=meter
visuals.asset_fail=true;recovery:bind(pawn)
assert(recovery.state.pawn==pawn and recovery.state.visual_error and old_pawn.refValidInteractActor==nil)
for _,part in pairs(old_parts)do assert(not part.alive)end
near(crosshair.opacity,.3);assert(crosshair.visibility==2)
set_ray(recovery,{x=0,y=0,z=0},{x=1,y=0,z=0},true);assert(recovery:trace())
visuals.asset_fail=false;test_time=recovery.state.visual_retry_at;assert(recovery:trace())
assert(recovery.state.visual_error==nil and recovery.state.parts.tip.alive)
local calls_before=reflected_calls
assert(new_hook.pre(nil,pawn)==false and new_hook.pre(nil,old_pawn)==nil and reflected_calls==calls_before,'respawn hook stays instance-bound and non-reentrant')
-- Valid UObject handles alone do not prove their render resources survived
-- travel. Rebuild lost rendering while preserving the usable interaction ray.
local before_damage=recovery.state.parts
before_damage.selected_tip.lost_render_state=true
test_time=test_time+1.1;assert(recovery:trace() and pawn.refValidInteractActor==door)
assert(not before_damage.selected_tip.alive and recovery.state.parts.selected_tip~=before_damage.selected_tip)
assert(recovery.state.parts.selected_tip.visible and not recovery.state.visual_error)
recovery:cleanup();assert(next(recovery.state.parts)==nil and not recovery.state.pawn and not recovery.state.visual_error)
`);

console.log('PASS: pointer selection, feedback, render recovery and cleanup');
