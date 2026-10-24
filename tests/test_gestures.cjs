const SRC=require('path').resolve(__dirname,'../src');
const fs=require('fs');
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=require('fengari');
const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
function run(s){if(lauxlib.luaL_dostring(L,to_luastring(s))!==lua.LUA_OK)throw Error(to_jsstring(lua.lua_tostring(L,-1)));}
run('IK=(function()\n'+fs.readFileSync(SRC+'/ik_math.lua','utf8')+'\nend)()');
run('Gestures=(function()\n'+fs.readFileSync(SRC+'/gestures.lua','utf8')+'\nend)()');
run(`
local V,Q=IK.vector,IK.quaternion
local function near(a,b,e) assert(math.abs(a-b)<(e or 1e-5),tostring(a).." differs from "..tostring(b)) end
local function T(x,y,z,rotation,scale)
 return {Translation={X=x,Y=y,Z=z},Rotation=rotation or {X=0,Y=0,Z=0,W=1},Scale3D=scale or {X=1,Y=1,Z=1}}
end
local controls={}
for _,side in ipairs({'left','right'}) do
 for t=0,1 do for g=0,1 do for thumb=0,1 do
  local state=Gestures.classify(side,{trigger=t==1,grip=g==1,thumb_touch=thumb==1})
  near(state.curls.index==nil and -1 or 0,0)
  assert((state.squeeze==true)==(side=='right' and t==1 and g==1))
  assert((state.pointing==true)==(side=='left' and t==0 and g==1))
  for _,n in pairs(state.curls) do assert(n>=0 and n<=1) end
  controls[#controls+1]={side=side,state=state}
 end end end
end
assert(Gestures.classify('left',{}).gesture=='open_palm')
assert(Gestures.classify('left',{grip=true}).gesture=='finger_gun')
assert(Gestures.classify('left',{grip=true,thumb_touch=true}).gesture=='point')
assert(Gestures.classify('left',{grip=true,trigger=true}).gesture=='thumb_up')
assert(Gestures.classify('left',{grip=true,trigger=true,thumb_touch=true}).gesture=='fist')
assert(Gestures.classify('right',{grip=true,trigger=true}).gesture=='fist')

-- Source zero is valid: UEVR OpenXR uses LEFT=0 and RIGHT=1.
local vr={is_openxr=function() return true end,
 get_left_joystick_source=function() return 0 end,get_right_joystick_source=function() return 1 end,
 get_action_handle=function(path) return path end,
 is_action_active=function(handle,source)
  if handle:find('/Grip$') then return true end
  if handle:find('ThumbrestTouchLeft$') then return source==0 end
  return false
 end}
local hands=Gestures.new(IK)
local sampled=hands:sample(vr)
assert(sampled.left.ready and sampled.right.ready)
assert(sampled.left.gesture=='point' and sampled.right.gesture=='rat_grasp')
assert(sampled.left.thumb_touch_available and not sampled.left.index_touch_available)
assert(sampled.left.thumb_touch and not sampled.right.thumb_touch)
-- The real C API typedef is an opaque pointer. Sol can marshal source0 as
-- nullptr->nil. A successful LEFT nil in OpenXR is valid and must be passed
-- through as nil, while RIGHT nil and failed getters remain invalid.
local nil_calls=0
local nil_vr={is_openxr=function() return true end,
 get_left_joystick_source=function() return nil end,
 get_right_joystick_source=function() return nil end,
 get_action_handle=function(path) return path end,
 is_action_active=function(handle,source)
  assert(source==nil,'nil source must be preserved for pointer binding')
  nil_calls=nil_calls+1
  return handle:find('/Grip$')~=nil
 end}
local nil_sample=Gestures.new(IK):sample(nil_vr)
assert(nil_sample.left.ready and nil_sample.left.gesture=='finger_gun')
assert(not nil_sample.right.ready and nil_calls>0)
nil_vr.get_left_joystick_source=function() error('getter failed') end
assert(not Gestures.new(IK):sample(nil_vr).left.ready)
nil_vr.get_left_joystick_source=function() return nil end
nil_vr.is_openxr=function() return false end
assert(not Gestures.new(IK):sample(nil_vr).left.ready)
nil_vr.get_left_joystick_source=function() return 0 end
assert(not Gestures.new(IK):sample(nil_vr).left.ready)
nil_vr.is_openxr=function() error('runtime query failed') end
assert(not Gestures.new(IK):sample(nil_vr).left.ready)
vr.get_action_handle=function(path) if path:find('Touch') then return 0 else return path end end
local limited=Gestures.new(IK):sample(vr)
assert(limited.left.ready and not limited.left.thumb_touch_available)
assert(limited.left.gesture=='finger_gun')
vr.get_action_handle=function() return 0 end
assert(not Gestures.new(IK):sample(vr).left.ready)

-- Optional supplied Oculus/OpenXR profile remaps only passive touch actions:
-- AButtonTouch=index contact and BButtonTouch=all thumb contacts (OR).
local cap_flags={index=false,thumb=false,trigger=false,grip=true}
local cap_vr={is_openxr=function() return true end,
 get_left_joystick_source=function() return nil end,
 get_right_joystick_source=function() return 1 end,
 get_action_handle=function(path) return path end,
 is_action_active=function(handle,source)
  if handle:find('/Trigger$') then return cap_flags.trigger end
  if handle:find('/Grip$') then return cap_flags.grip end
  if handle:find('/AButtonTouchLeft$') and source==nil then return cap_flags.index end
  if handle:find('/BButtonTouchLeft$') and source==nil then return cap_flags.thumb end
  return false
 end}
local cap_hands=Gestures.new(IK,{capacitive_aliases=true})
for trigger=0,1 do for grip=0,1 do for index=0,1 do for thumb=0,1 do
 cap_flags.trigger,cap_flags.grip,cap_flags.index,cap_flags.thumb=trigger==1,grip==1,index==1,thumb==1
 local state=cap_hands:sample(cap_vr).left
 assert(state.index_touch_available and state.thumb_touch_available)
 assert(state.thumb_touch==cap_flags.thumb and state.index_touch==cap_flags.index)
 near(state.curls.index,trigger==1 and 1 or (index==1 and .48 or 0))
 assert(state.pointing==(grip==1 and trigger==0 and index==0))
 if grip==1 and trigger==0 and index==0 then
  assert(state.gesture==(thumb==1 and 'point' or 'finger_gun'))
 end
end end end end
cap_flags.index=true;cap_flags.thumb=false;cap_flags.trigger=false;cap_flags.grip=true
local resting=cap_hands:sample(cap_vr).left
assert(resting.gesture=='thumb_up' and not resting.thumb_touch and not resting.pointing)
cap_vr.is_openxr=function() return false end
cap_vr.get_left_joystick_source=function() return 7 end
cap_vr.is_action_active=function(handle) return handle:find('/AButtonTouchLeft$')~=nil end
local openvr=cap_hands:sample(cap_vr).left
assert(not openvr.index_touch_available and openvr.thumb_touch and openvr.curls.index==0)
assert(not cap_hands.capabilities.index_touch)
cap_vr.is_openxr=function() return true end
local disabled=Gestures.new(IK,{capacitive_aliases=false}):sample(cap_vr).left
assert(not disabled.index_touch_available and disabled.thumb_touch)

local function apply(h,side,wrist,control,dt,opts)
 local emitted={}
 local result=h:apply(side,wrist,control,dt or 1/90,function(name,transform)
  assert(emitted[name]==nil,'duplicate setter call')
  emitted[name]=transform
 end,opts)
 for name,t in pairs(result.transforms) do
  assert(not name:find('lowerarm') and not name:find('upperarm') and not name:find('clavicle'))
  for _,vec in pairs(t) do for _,value in pairs(vec) do assert(value==value and math.abs(value)<1e10) end end
  near(V.length(V.read(t.Scale3D)),math.sqrt(3),1e-4)
  local q=Q.normalize(t.Rotation);near(q.x*q.x+q.y*q.y+q.z*q.z+q.w*q.w,1)
 end
 near(V.length(result.direction),1)
 return result,emitted
end
for _,item in ipairs(controls) do
 local h=Gestures.new(IK)
 local result,emitted=apply(h,item.side,T(0,0,0),item.state)
 near(result.writes,107)
 local count=0;for _ in pairs(emitted) do count=count+1 end;near(count,107)
 local rest=apply(h,item.side,T(0,0,0),item.state)
 near(rest.writes,0)
 -- Mirrored reference hierarchies contain both wrist corrective children.
 local suffix=item.side=='left' and 'l' or 'r'
 assert(result.transforms['wrist_inner_'..suffix] and result.transforms['wrist_outer_'..suffix])
end
-- Reference mirroring and inward curl are checked in each anatomical frame.
local palms={}
for _,side in ipairs({'left','right'}) do
 local h=Gestures.new(IK)
 local open=Gestures.classify('left',{})
 local rest=apply(h,side,T(0,0,0),open)
 local closed=Gestures.classify('right',{trigger=true,grip=true})
 local fist=rest
 for i=1,100 do fist=apply(h,side,T(0,0,0),closed) end
 local ref=Gestures.reference[side]
 local suffix=side=='left' and 'l' or 'r'
 local curl_delta=V.sub(fist.transforms['index_03_'..suffix].Translation,rest.transforms['index_03_'..suffix].Translation)
 assert(V.dot(curl_delta,ref.palmar)>1,'finger failed to bend into palm '..side..' '..V.dot(curl_delta,ref.palmar))
 local knuckle=rest.transforms['index_01_'..suffix].Translation
 assert(V.length(V.sub(fist.transforms['index_03_'..suffix].Translation,knuckle))<
        V.length(V.sub(rest.transforms['index_03_'..suffix].Translation,knuckle)))
 palms[side]={length=V.length(rest.origin),fist=V.length(fist.origin),curl=V.dot(curl_delta,ref.palmar)}
end
near(palms.left.length,palms.right.length,.01)
near(palms.left.fist,palms.right.fist,.01)
near(palms.left.curl,palms.right.curl,.01)
-- Frozen reference-local children follow any wrist orientation. No source pose.
local h=Gestures.new(IK)
local control=Gestures.classify('left',{grip=true,thumb_touch=true})
local base=apply(h,'left',T(0,0,0),control)
assert(base.pointing)
local rotation=Q.normalize({x=.2,y=-.4,z=.7,w=.9})
local shift=V.new(20,30,-40)
local moved=apply(h,'left',T(shift.x,shift.y,shift.z,rotation),control)
near(moved.writes,0)
near(V.length(V.sub(moved.direction,Q.rotate(rotation,base.direction))),0)
near(V.length(V.sub(moved.origin,V.add(shift,Q.rotate(rotation,base.origin)))),0)
-- Only deform joints need writes during a gesture transition: metacarpals and
-- corrective descendants retain reference-local transforms under their parent.
local closing=apply(h,'left',T(0,0,0),Gestures.classify('left',{trigger=true,grip=true,thumb_touch=true}))
assert(closing.writes<=16 and closing.writes>0)
assert(not closing.pointing)
local forced=apply(h,'left',T(0,0,0),control,1/90,{force_reference=true})
near(forced.writes,107)
h:reset('left')
near(apply(h,'left',T(0,0,0),control).writes,107)
assert(not pcall(function() h:apply('left',T(0,0,0),control,0/0,function() end) end))
assert(not pcall(function() h:apply('left',T(0,0,0),{curls={index=0/0}},.01,function() end) end))
`);
console.log('PASS: gestures, joint hierarchy, wrist independence, closure, input fallback and smoothing');
