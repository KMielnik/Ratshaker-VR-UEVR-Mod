-- Pure Lua component-space two-bone IK. Units: Unreal centimeters.
-- solve(upperTransform,lowerTransform,handTransform,targetPosition,options)
-- Returns upper/lower/hand component transforms and reach diagnostics.
local M={}
local EPS=1e-7
local function component(v,k) local n=v[k]; if n==nil then n=v[string.upper(k)] end; return n end
local function finite(n) return type(n)=="number" and n==n and math.abs(n)<1e12 end
local function v(x,y,z) return {x=x,y=y,z=z} end
local function read(vv)
 local x,y,z=component(vv,"x"),component(vv,"y"),component(vv,"z")
 assert(finite(x) and finite(y) and finite(z),"Nonfinite vector")
 return v(x,y,z)
end
local function add(a,b) return v(a.x+b.x,a.y+b.y,a.z+b.z) end
local function sub(a,b) return v(a.x-b.x,a.y-b.y,a.z-b.z) end
local function mul(a,s) return v(a.x*s,a.y*s,a.z*s) end
local function dot(a,b) return a.x*b.x+a.y*b.y+a.z*b.z end
local function cross(a,b) return v(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x) end
local function length(a) return math.sqrt(dot(a,a)) end
local function normalize(a,fallback)
 local n=length(a); if n<EPS then return fallback or v(1,0,0) end
 return mul(a,1/n)
end
local function perpendicular(a)
 local ax,ay,az=math.abs(a.x),math.abs(a.y),math.abs(a.z)
 local basis= ax<=ay and ax<=az and v(1,0,0) or (ay<=az and v(0,1,0) or v(0,0,1))
 return normalize(cross(a,basis))
end
local function qnorm(q)
 local x,y,z,w=component(q,"x"),component(q,"y"),component(q,"z"),component(q,"w")
 assert(finite(x) and finite(y) and finite(z) and finite(w),"Nonfinite quaternion")
 local n=math.sqrt(x*x+y*y+z*z+w*w); assert(n>EPS,"Zero quaternion")
 return {x=x/n,y=y/n,z=z/n,w=w/n}
end
local function qmul(a,b)
 return {x=a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,
 y=a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,
 z=a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,
 w=a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z}
end
local function qinverse(q) q=qnorm(q);return {x=-q.x,y=-q.y,z=-q.z,w=q.w} end
local function qrotate(q,a)
 q=qnorm(q)
 local t=mul(cross(v(q.x,q.y,q.z),a),2)
 return add(a,add(mul(t,q.w),cross(v(q.x,q.y,q.z),t)))
end
local function arc(a,b)
 a,b=normalize(a),normalize(b)
 local d=math.max(-1,math.min(1,dot(a,b)))
 if d>1-1e-10 then return {x=0,y=0,z=0,w=1} end
 if d< -1+1e-10 then local p=perpendicular(a); return {x=p.x,y=p.y,z=p.z,w=0} end
 local c=cross(a,b); return qnorm({x=c.x,y=c.y,z=c.z,w=1+d})
end
local function position(t) return read(t.Translation or t.translation or t.position) end
local function rotation(t) return qnorm(t.Rotation or t.rotation) end
local function transform(p,q,source,stretch)
 local s=read(source.Scale3D or source.scale or v(1,1,1))
 return {Translation={X=p.x,Y=p.y,Z=p.z},Rotation={X=q.x,Y=q.y,Z=q.z,W=q.w},
 Scale3D={X=s.x*(stretch or 1),Y=s.y*(stretch or 1),Z=s.z*(stretch or 1)}}
end
function M.solve(upper,lower,hand,target,opts)
 opts=opts or {}; target=read(target)
 local shoulder,old_elbow,old_hand=position(upper),position(lower),position(hand)
 local old_u,old_l=sub(old_elbow,shoulder),sub(old_hand,old_elbow)
 local l1,l2=length(old_u),length(old_l)
 assert(l1>EPS and l2>EPS,"Degenerate source arm")
 local delta=sub(target,shoulder); local distance=length(delta)
 local direction=normalize(delta,normalize(sub(old_hand,shoulder)))
 local original_shoulder=shoulder
 local max_stretch=opts.max_stretch or 1.03
 assert(finite(max_stretch) and max_stretch>=1 and max_stretch<=2,"Invalid maximum stretch")
 local stretch=math.min(max_stretch,math.max(1,distance/(l1+l2)))
 l1,l2=l1*stretch,l2*stretch
 local maximum=l1+l2
 local minimum=math.abs(l1-l2)+1e-5
 -- Wrist is authoritative. Extreme reaches move the virtual shoulder instead
 -- of clamping the controller target; small reaches permit bounded stretch.
 if distance>maximum then
  shoulder=add(shoulder,mul(direction,distance-maximum))
  distance=maximum
 elseif distance<minimum then
  shoulder=sub(target,mul(direction,minimum))
  distance=minimum
 end
 local hint=opts.elbow_hint and read(opts.elbow_hint) or v(0,opts.side=="left" and -1 or 1,-0.45)
 local pole=sub(hint,mul(direction,dot(hint,direction)))
 if length(pole)<EPS then pole=perpendicular(direction) else pole=normalize(pole) end
 local along=(l1*l1-l2*l2+distance*distance)/(2*distance)
 local height=math.sqrt(math.max(0,l1*l1-along*along))
 local elbow=add(shoulder,add(mul(direction,along),mul(pole,height)))
 local upper_q=qnorm(qmul(arc(old_u,sub(elbow,shoulder)),rotation(upper)))
 local lower_q=qnorm(qmul(arc(old_l,sub(target,elbow)),rotation(lower)))
 local hand_q=opts.hand_rotation and qnorm(opts.hand_rotation) or rotation(hand)
 return {upper=transform(shoulder,upper_q,upper,stretch),lower=transform(elbow,lower_q,lower,stretch),
 hand=transform(target,hand_q,hand),elbow=elbow,shoulder=shoulder,wrist=target,
 shoulder_shift=sub(shoulder,original_shoulder),stretch=stretch,upper_length=l1,lower_length=l2}
end
M.vector={new=v,read=read,add=add,sub=sub,mul=mul,dot=dot,cross=cross,length=length,normalize=normalize}
M.quaternion={normalize=qnorm,multiply=qmul,inverse=qinverse,rotate=qrotate,shortest_arc=arc}
-- Convert an orientation through an orthonormal coordinate basis. Columns
-- describe where source X/Y/Z map in destination coordinates. A reflection
-- changes quaternion vector signs: quaternions are axial, not polar vectors.
-- Caller must provide its verified tracking-to-UE basis; no UEVR assumption.
function M.basis_quaternion(q,columns)
 q=qnorm(q)
 local a,b,c=read(columns[1]),read(columns[2]),read(columns[3])
 local det=dot(a,cross(b,c))
 assert(math.abs(math.abs(det)-1)<1e-5 and math.abs(dot(a,b))<1e-5 and math.abs(dot(a,c))<1e-5 and math.abs(dot(b,c))<1e-5,"Basis must be orthonormal")
 local vector=mul(add(add(mul(a,q.x),mul(b,q.y)),mul(c,q.z)),det)
 return qnorm({x=vector.x,y=vector.y,z=vector.z,w=q.w})
end
-- Calibrate once: offset=inverse(controllerUE)*restPalmUE.
function M.palm_offset(controllerUE,restPalmUE) return qnorm(qmul(qinverse(controllerUE),qnorm(restPalmUE))) end
function M.palm_rotation(controllerUE,offset) return qnorm(qmul(qnorm(controllerUE),qnorm(offset))) end
-- Map wrist-local reference anatomy to controller-local +X aim and +Z thumb.
function M.palm_basis_offset(finger,thumb)
 local forward=normalize(read(finger))
 assert(length(read(finger))>EPS,"Degenerate palm finger axis")
 local radial=sub(read(thumb),mul(forward,dot(read(thumb),forward)))
 assert(length(radial)>EPS,"Degenerate palm thumb axis")
 radial=normalize(radial)
 local first=arc(forward,v(1,0,0))
 local second=arc(qrotate(first,radial),v(0,0,1))
 return qnorm(qmul(second,first))
end
-- UEVR 1.05 get_pose returns the grip pose, not the aim pose. OpenXR grip
-- -Z runs along the held handle toward the thumb; +X is the side-specific
-- palm normal. After our XR->UE basis change: thumb=+X, fingers=-Z.
-- The existing aim basis (fingers=+X, thumb=+Z) was 90 degrees wrong.
function M.grip_basis_offset(finger,thumb)
 local h=math.sqrt(.5)
 return qnorm(qmul({x=0,y=h,z=0,w=h},M.palm_basis_offset(finger,thumb)))
end
-- OpenXR/OpenVR tracking meters (+X right,+Y up,-Z forward) into Unreal
-- centimeters (+X forward,+Y right,+Z up). Solve the tracking-space origin
-- from this frame's rendered HMD, so turning/leaning the head cancels out.
function M.tracked_world(raw,raw_head,world_head,units)
 assert(finite(units) and units>0,"Invalid tracking scale")
 local basis={v(0,1,0),v(0,0,1),v(-1,0,0)}
 local function map(p) p=read(p);return v(-p.z,p.x,p.y) end
 local base=qmul(rotation(world_head),qinverse(M.basis_quaternion(rotation(raw_head),basis)))
 return {Translation=add(position(world_head),qrotate(base,mul(map(sub(position(raw),position(raw_head))),units))),
  Rotation=qmul(base,M.basis_quaternion(rotation(raw),basis)),Scale3D=v(1,1,1)}
end
return M
