const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');const path=require('path');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
for(const [n,f] of [['IK','ik_math.lua'],['Motion','motion.lua'],['Rate','shake_rate.lua'],['Gestures','gestures.lua'],['Calibration','calibration.lua'],['Turning','turning.lua'],['Squeeze','squeeze.lua']])run(n+'=(function()\n'+fs.readFileSync(path.join(SRC,f),'utf8')+'\nend)()');
run(`
callbacks={};objects={};address=100;menu=false;runtime=true;hmd=true;controls=true;rt=false;rg=false;lt=false;lg=true;touch=true
tick_counter=0;timer_clears=0;loaded_house=0;native_meter=0;axis_hook=nil;start_hook=nil;shake_enters=0;squeeze_enters=0;squeeze_exits=0
local function copy(t)if type(t)~='table'then return t end;local r={};for k,v in pairs(t)do r[k]=copy(v)end;return r end
function T(x,y,z)return{Translation={X=x,Y=y,Z=z},Rotation={X=0,Y=0,Z=0,W=1},Scale3D={X=1,Y=1,Z=1}}end
function object(kind)
 address=address+1;local o={kind=kind,address=address,alive=true,visible=true,world=T(0,0,0),bones={}}
 local cls={get_address=function()return kind=='pawn' and 10 or address end}
 function cls:find_function(name)return{hook_ptr=function(_,pre,post)
  if name=='UpdateMouseAxisInputValues'then axis_hook=post elseif name=='StartRatShakingMouseInput'then start_hook=post elseif name=='TriggerHeadBobCameraShake'then bob_hook=pre end end}end
 function o:get_class()return cls end;function o:get_address()return self.address end
 function o:K2_GetComponentToWorld()return copy(self.world)end
 function o:K2_SetWorldTransform(t)self.world=copy(t)end
 function o:K2_SetRelativeTransform(t)self.relative=copy(t)end
 function o:GetSocketTransform(n)return copy(self.bones[n] or self.world)end
 function o:GetBoneTransformByName(n)return copy(self.bones[n] or T(0,0,0))end
 function o:SetBoneTransformByName(n,t)self.bones[n]=copy(t)end
 function o:GetAttachParent()return self.parent end;function o:GetAttachSocketName()return self.socket end
 function o:K2_AttachToComponent(p,s)self.parent,self.socket=p,s end
 function o:IsVisible()return self.visible end;function o:SetVisibility(v)self.visible=v end
 function o:GetSkeletalMeshAsset()return self end
 function o:SetSkinnedAssetAndUpdate(asset)assert(asset);self.asset=asset end
 function o:CopyPoseFromSkeletalComponent(src)self.bones=copy(src.bones)end
 function o:GetNumMaterials()return 1 end;function o:GetMaterial()return nil end
 function o:K2_DestroyComponent()self.alive=false end
 for _,n in ipairs({'SetCollisionEnabled','SetGenerateOverlapEvents','SetCastShadow','SetOnlyOwnerSee','SetMaterial','SetMovementMode','EnableInput','ResetIgnoreMoveInput','ResetIgnoreLookInput','Montage_Stop','SetInputMode_GameOnly'})do o[n]=function()end end
 objects[#objects+1]=o;return o
end
source=object('source');source.VisibilityBasedAnimTickOption=3
for _,s in ipairs({'l','r'})do local sign=s=='l'and-1 or 1
 source.bones['clavicle_'..s]=T(-17.8,18*sign,-19);source.bones['upperarm_'..s]=T(0,18*sign,-19)
 source.bones['lowerarm_'..s]=T(27.77,18*sign,-19);source.bones['hand_'..s]=T(55.02,18*sign,-19)
end
animation=object('anim');function source:GetAnimInstance()return animation end
rat=object('rat');rat.parent=source;rat.socket='lowerarm_r';rat.world=T(55.02,18,-19)
player=object('pawn');player.FirstPersonMesh=source;player.Rat2D=rat;player.CharacterMovement=object('movement')
player.bHoldToShake=false;player.NewVar=40;player.mouseAxisShakeDetectThreshold=.3;player.targetMouseInputAxisXValue=0;player.targetMouseInputAxisYValue=0
player.bCanRatShake=true;player.bCanRatSqueeze=true;player.th_RatShakeCountIncrement={active=false};player.th_DrainWhenHeld={active=false};squeeze_drains=0
player.ACOMP_ShakeMeter=object('meter');player.ACOMP_ShakeMeter.currentShakeMeterValue=0
function player:get_full_name()return 'CHAR_RatshakerPlayer_C /Game/Ratshaker/LE_RS_TheHouse_Master.Player'end
function player:AddComponentByClass(c)return object(c.kind)end
function player:GetActorForwardVector()return{x=1,y=0,z=0}end
function player:GetActorRightVector()return{x=0,y=1,z=0}end
function player:EnterShakingMode()self.bShakingMode=true;shake_enters=shake_enters+1 end
function player:ExitShakingMode()self.bShakingMode=false end
function player:EnterRatSqueeze()squeeze_enters=squeeze_enters+1;self.bRatSqueeze=true;self.th_DrainWhenHeld.active=true end
function player:DrainShakeMeterWhenSqueezing()assert(not self.th_DrainWhenHeld.active);squeeze_drains=squeeze_drains+1 end
function player:ExitRatSqueeze()squeeze_exits=squeeze_exits+1 end
function player:StartRatShakingMouseInput()
 -- UEVR1.05 dispatches this hook through the same non-recursive global
 -- script callback lock already held by on_pre_engine_tick.
 if start_hook then error('resource deadlock would occur: hook reentered Lua tick') end
 self.th_RatShakeCountIncrement.active=true
end
function player:StopRatShakingMouseInput()self.th_RatShakeCountIncrement.active=false end
function player:IncrementShakeCounterAndDetectIfShaking()
 assert(self.bShakingMode and self.NewVar<0,'native counter called without valid mode/motion')
 native_meter=native_meter+1;tick_counter=tick_counter+1;self.ACOMP_ShakeMeter.currentShakeMeterValue=native_meter
end
controller=object('controller');controller.bShowMouseCursor=false;controller.bUsingGamepad=false
system=object('system');function system:K2_ClearAndInvalidateTimerHandle(p,t)assert(p==player);t.active=false;timer_clears=timer_clears+1 end
function system:K2_GetTimerRemainingTimeHandle(p,t)assert(p==player and t==p.th_DrainWhenHeld);return 0 end
gameplay=object('gameplay');function gameplay:OpenLevel(p,n)assert((p==player or p==controller) and n:find('LE_RS_TheHouse_Master'));loaded_house=loaded_house+1 end
widgets=object('widgets')
raw={x=0,y=0,z=0};head={x=0,y=0,z=0};left={x=30,y=-25,z=-25};right={x=34,y=21,z=-10}
UEVR_Vector3f={new=function()return{x=0,y=0,z=0}end};UEVR_Quaternionf={new=function()return{x=0,y=0,z=0,w=1}end}
UEVR_UObjectHook={activate=function()end,exists=function(o)return o and o.alive end,
 remove_motion_controller_state=function()end,get_objects_by_class=function()return{}end,
 get_or_add_motion_controller_state=function(o)return{set_hand=function(_,h)o.hand=h end,set_permanent=function()end,set_location_offset=function()end}end}
mod_values={VR_MotionControlsInactivityTimer='30',VR_WorldScale='1'}
uevr={api={get_local_pawn=function()return player end,get_player_controller=function()return controller end,
 find_uobject=function(_,n)
  if n:find('GameplayStatics')then return{get_class_default_object=function()return gameplay end}end
  if n:find('KismetSystemLibrary')then return{get_class_default_object=function()return system end}end
  if n:find('WidgetBlueprintLibrary')then return{get_class_default_object=function()return widgets end}end
  if n:find('LevelSequencePlayer')then return nil end
  return{kind=n:find('Poseable')and'poseable'or'proxy'}end},
 params={functions={is_drawing_ui=function()return menu end},vr={
 is_openxr=function()return true end,is_runtime_ready=function()return runtime end,is_hmd_active=function()return hmd end,is_using_controllers=function()return controls end,
 get_hmd_index=function()return 0 end,get_left_controller_index=function()return 1 end,get_right_controller_index=function()return 2 end,
 get_left_joystick_source=function()return 0 end,get_right_joystick_source=function()return 1 end,get_action_handle=function(n)return n end,
 is_action_active=function(n,s)if n:find('/Trigger')then return s==0 and lt or(s==1 and rt)elseif n:find('/Grip')then return s==0 and lg or(s==1 and rg)elseif n:find('BButtonTouch')or n:find('ThumbrestTouch')then return touch else return false end end,
 get_pose=function(index,p)
  local world=index==0 and head or(index==1 and left or right)
  p.x,p.y,p.z=world.y/100,world.z/100,-world.x/100
  if index==2 then p.x,p.y,p.z=p.x+raw.x,p.y+raw.y,p.z+raw.z end
 end,get_lowest_xinput_index=function()return 0 end,
 set_mod_value=function(k,v)mod_values[k]=v end,get_mod_value=function(_,k)return mod_values[k]or'0'end}},
 sdk={callbacks=setmetatable({},{__index=function(_,n)return function(fn)callbacks[n]=fn end end})}}
imgui={text=function()end,checkbox=function(_,v)return false,v end,button=function()return false end,slider_float=function(_,v)return false,v end}
Visuals={new=function()return{status='test visuals',update=function()end,set_visible=function()end,post_update=function()end,cleanup=function()end}end}
HUD={new=function()return{status='native HUD',update=function()end,pause=function()end,cleanup=function()end}end}
Rendering={new=function()return{status='test rendering',cfg={fill_strength=.5},set_fill_strength=function(self,v)self.cfg.fill_strength=v end,update=function()end,pause=function()end,cleanup=function()end}end}
pointer_trace_count=0;pointer_pointing=false;last_ray=nil
Pointer={new=function()return{bind=function()end,pause=function()pointer_pointing=false end,cleanup=function()end,
 update=function(_,p,d,active)last_ray={p=p,d=d};pointer_pointing=active end,
 trace=function()pointer_trace_count=pointer_trace_count+1 end}end}
function tick(dt)
 callbacks.on_pre_engine_tick(nil,dt or 1/90)
 for _,o in ipairs(objects)do if o.alive and o.kind=='proxy'then local p=o.hand==0 and left or(o.hand==1 and right or head);o.world=T(p.x,p.y,p.z)end end
 callbacks.on_post_calculate_stereo_view_offset(nil,1,100,head,{x=0,y=0,z=0})
 if callbacks.on_post_engine_tick then callbacks.on_post_engine_tick()end
end
function visual()for i=#objects,1,-1 do if objects[i].alive and objects[i].kind=='poseable'then return objects[i]end end end
function near(a,b)assert(math.abs(a-b)<1e-5,tostring(a)..' differs '..tostring(b))end
`);
run(fs.readFileSync(path.join(SRC,'runtime.lua'),'utf8'));
run(`
-- Independent coordinate examples: tracking meters/right-up-back basis,
-- a 90-degree body turn, then an isolated HMD yaw with stationary hands.
local function pose(x,y,z,q)return{Translation={x=x,y=y,z=z},Rotation=q or{x=0,y=0,z=0,w=1},Scale3D={x=1,y=1,z=1}}end
local c=math.sqrt(.5)
local rh=pose(0,1.6,0);local hand=pose(.2,1.3,-.4)
local wh=pose(100,300,170,{x=0,y=0,z=c,w=c})
local out=IK.tracked_world(hand,rh,wh,100)
near(out.Translation.x,80);near(out.Translation.y,340);near(out.Translation.z,140)
rh.Rotation={x=0,y=c,z=0,w=c};wh.Rotation={x=0,y=0,z=0,w=1}
local looked=IK.tracked_world(hand,rh,wh,100)
near(looked.Translation.x,80);near(looked.Translation.y,340);near(looked.Translation.z,140)
near(math.abs(looked.Rotation.z),c);near(math.abs(looked.Rotation.w),c)
-- Translating the HMD in tracking/world space must also cancel from the hand.
rh.Translation.x=.1;wh.Translation.x=90
local leaned=IK.tracked_world(hand,rh,wh,100)
near(leaned.Translation.x,80);near(leaned.Translation.y,340);near(leaned.Translation.z,140)
-- Independent OpenXR grip convention: -Z points toward thumb, +X is
-- outward from left palm / inward through right palm. In mapped UE space
-- these are +X and +Y. Open fingers extend along grip -Y => Unreal -Z.
for _,side in ipairs({'left','right'}) do
 local ref=Gestures.reference[side]
 local offset=IK.grip_basis_offset(ref.forward,ref.radial)
 local finger=IK.quaternion.rotate(offset,ref.forward)
 local thumb=IK.quaternion.rotate(offset,ref.radial)
 local normal=IK.quaternion.rotate(offset,ref.palmar)
 near(finger.x,0);near(finger.y,0);near(finger.z,-1)
 near(thumb.x,1);near(thumb.y,0);near(thumb.z,0)
 near(normal.x,0);near(normal.y,side=='left' and 1 or -1);near(normal.z,0)
 -- A physical grip rotation carries both anatomical axes with it.
 local turn={x=0,y=0,z=c,w=c}
 local wrist=IK.palm_rotation(turn,offset)
 local turned_thumb=IK.quaternion.rotate(wrist,ref.radial)
 near(turned_thumb.x,0);near(turned_thumb.y,1);near(turned_thumb.z,0)
end
`);
run(`
tick();assert(loaded_house==0,'native menu progression was bypassed');tick();local mesh=visual();assert(mesh and mesh.visible and not source.visible,'rig not activated')
assert(player.bCanPlayerMoveAndLook==nil and player.bCanRatShake and player.bCanRatSqueeze,'story ability gates were overwritten')
near(mesh.bones.hand_l.Translation.X,left.x);near(mesh.bones.hand_r.Translation.Z,right.z)
assert(pointer_pointing,'left pointer gesture not routed')
-- A same-frame mouse classification must not turn a scaled stick input into
-- 15x yaw, and the idle shake bridge must leave smooth yaw alone.
controller.bUsingGamepad=false;player.targetMouseInputAxisXValue=12;player.targetMouseInputAxisYValue=3
axis_hook(nil,player);assert(controller.bUsingGamepad and player.targetMouseInputAxisXValue==12 and player.targetMouseInputAxisYValue==0,'look-boundary guard missing')
tick();assert(player.targetMouseInputAxisXValue==12,'idle shake bridge erased smooth turning')
local turnpad={Gamepad={sThumbRX=16000,sThumbRY=9000}}
callbacks.on_xinput_get_state(nil,0,turnpad);assert(turnpad.Gamepad.sThumbRX==16000 and turnpad.Gamepad.sThumbRY==0,'smooth stick was suppressed')
mod_values.VR_SnapTurn='true';turnpad.Gamepad.sThumbRX=16000;callbacks.on_xinput_get_state(nil,0,turnpad)
assert(turnpad.Gamepad.sThumbRX==0,'first snap packet leaked native smooth turn')
player.targetMouseInputAxisXValue=12;axis_hook(nil,player);assert(player.targetMouseInputAxisXValue==0,'snap hook leaked native yaw')
mod_values.VR_SnapTurn='false'
local xr=mesh.bones.hand_r.Translation.X;head.x=30;tick();near(mesh.bones.hand_r.Translation.X,xr)
left.y=-42;tick();near(mesh.bones.hand_l.Translation.Y,-42);near(mesh.bones.hand_r.Translation.X,xr)
rt=true;for i=1,90 do tick()end;assert(player.bShakingMode and tick_counter==0,'stationary trigger fills meter')
for i=1,270 do raw.x=.08*math.sin(i/90*2*math.pi*3);tick()end
assert(tick_counter>=6 and tick_counter<=18 and timer_clears>0 and not player.th_RatShakeCountIncrement.active,'native motion credit/timer bridge failed')
local total=tick_counter;rg=true;tick();assert(squeeze_drains==1 and squeeze_enters==1 and not player.bShakingMode and pointer_trace_count>0,'trigger+grip did not squeeze left target')
for i=1,90 do raw.x=.08*math.sin(i/90*2*math.pi*4);tick()end
assert(tick_counter==total and squeeze_enters==1,'squeeze also shakes/repeats')
rt=false;tick();assert(squeeze_exits==1,'releasing trigger did not exit squeeze')
lt=true;tick();assert(not pointer_pointing,'left fist still points')
local pad={Gamepad={bRightTrigger=255,bLeftTrigger=255}};callbacks.on_xinput_get_state(nil,0,pad);assert(pad.Gamepad.bRightTrigger==0 and pad.Gamepad.bLeftTrigger==0,'duplicate native input')
menu=true;tick();assert(source.visible and not mesh.visible and rat.parent==source,'menu restoration')
menu=false;tick();assert(mesh.visible and not source.visible,'resume')
hmd=false;tick();assert(source.visible and not mesh.visible,'headset loss')
hmd=true;tick();tick(.25);assert(mesh.visible,'slow frame hid wrists')
-- Transient component availability after a restart must not exhaust a fixed
-- three-attempt lifetime quota. A destroyed rig recovers on the same pawn.
mesh.alive=false;local create=player.AddComponentByClass;local failures=0
function player:AddComponentByClass(c)
 if c.kind=='poseable' and failures<4 then failures=failures+1;error('simulated streaming delay')end
 return create(self,c)
end
player.bCanRatShake=false;player.bCanRatSqueeze=false
for i=1,16 do tick(1)end
local rebuilt=visual();assert(failures==4 and rebuilt and rebuilt~=mesh and rebuilt.visible,'same-pawn rig never recovered after four build failures')
assert(not player.bCanRatShake and not player.bCanRatSqueeze and loaded_house==0,'recovery bypassed story progression or ability gates')
callbacks.on_script_reset();assert(source.visible and source.VisibilityBasedAnimTickOption==3 and rat.parent==source,'reset rollback')
assert(controller.bUsingGamepad==false,'reset left native controller classification overridden')
near(player.NewVar,40);assert(not player.bHoldToShake and mod_values.VR_MotionControlsInactivityTimer=='30')
for _,o in ipairs(objects)do if o.kind=='poseable'or o.kind=='proxy'then assert(not o.alive,'leaked owned component')end end
print('PASS: integrated runtime independently positions wrists with HMD isolation, routes left gesture ray, enters shake only with trigger and motion, scales native ticks, gives trigger+grip squeeze priority, clears native fixed timer, blocks duplicate XInput and restores native state on reset.')
`);
